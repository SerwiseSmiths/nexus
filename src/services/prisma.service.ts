import { PrismaClient } from "@prisma/client";

let _client: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient();
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
