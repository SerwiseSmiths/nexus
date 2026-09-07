import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

let _client: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_client) {
    // Neon's serverless WebSocket adapter requires a real Neon endpoint — it
    // can't reach the plain local Postgres `nexus_test` database the test
    // suite runs against (see docs/authentication.md §9). Every other
    // environment (local dev against Neon, staging, prod) uses the adapter.
    if (process.env.NODE_ENV === 'test') {
      _client = new PrismaClient();
    } else {
      const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
      _client = new PrismaClient({ adapter });
    }
  }
  return _client;
}

// Defer instantiation until first use so process.env.DATABASE_URL is set by
// initializeConfig() before Prisma reads it.
export default new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
