import { execSync } from 'child_process';
import { initializeConfig } from '../configs';

type Stage = 'local' | 'development' | 'production';

async function deployMigration(stage: Stage) {
  console.log(`\n🚀 Applying migrations for: ${stage.toUpperCase()}`);
  process.env.NODE_ENV = stage;

  const config = await initializeConfig();

  if (!config.databaseUrl) {
    throw new Error(`Missing databaseUrl for ${stage} in config.`);
  }

  const env = {
    ...process.env,
    DATABASE_URL: config.databaseUrl,
    DIRECT_URL: config.directUrl ?? config.databaseUrl,
  };

  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
  execSync('npx prisma generate', { env, stdio: 'inherit' });

  console.log(`✅ Migration and client generation successful for ${stage}`);
}

async function main() {
  const arg = process.argv[2] as Stage | 'all' | undefined;

  const stages: Stage[] =
    !arg || arg === 'all'
      ? ['local', 'development', 'production']
      : [arg as Stage];

  try {
    for (const stage of stages) {
      await deployMigration(stage);
    }
    console.log('\n✨ All migrations completed successfully.');
  } catch (error: any) {
    console.error('\n🛑 Migration process aborted:', error.message);
    process.exit(1);
  }
}

main();
