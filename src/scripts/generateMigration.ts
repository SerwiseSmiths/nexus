import { execSync } from 'child_process';
import { initializeConfig } from '../configs';

async function main() {
  process.env.NODE_ENV = 'local';
  const config = await initializeConfig();

  if (!config.databaseUrl) {
    throw new Error('Missing databaseUrl for local environment.');
  }

  const name = process.argv[2];
  const cmd = name
    ? `npx prisma migrate dev --name ${name}`
    : 'npx prisma migrate dev';

  console.log(`\n🔨 Generating migration${name ? `: ${name}` : ''} against local DB...`);

  execSync(cmd, {
    env: {
      ...process.env,
      DATABASE_URL: config.databaseUrl,
      DIRECT_URL: config.directUrl ?? config.databaseUrl,
    },
    stdio: 'inherit',
  });

  console.log('\n✅ Migration generated. Commit the new file in prisma/migrations/.');
}

main().catch((e: any) => {
  console.error('\n🛑 Generate failed:', e.message);
  process.exit(1);
});
