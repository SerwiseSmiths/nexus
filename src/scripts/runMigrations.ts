import { execSync } from 'child_process';
import { initializeConfig } from '../configs';

async function runPrismaMigration(stage: 'development' | 'production') {
  console.log(`\n🚀 Starting migration for environment: ${stage.toUpperCase()}`);
  
  // Set NODE_ENV for config resolution
  process.env.NODE_ENV = stage;
  
  try {
    const config = await initializeConfig();
    
    if (!config.databaseUrl || !config.directUrl) {
      throw new Error(`Missing databaseUrl or directUrl for ${stage} in Remote Config.`);
    }

    console.log(`📦 Resolved URLs for ${stage}. Running 'prisma migrate deploy'...`);

    // Execute Prisma command with resolved environment variables
    execSync('npx prisma migrate deploy', {
      env: {
        ...process.env,
        DATABASE_URL: config.databaseUrl,
        DIRECT_URL: config.directUrl,
      },
      stdio: 'inherit',
    });

    console.log(`✅ Migration successful for ${stage}`);
  } catch (error: any) {
    console.error(`❌ Migration failed for ${stage}:`, error.message);
    throw error;
  }
}

async function main() {
  try {
    await runPrismaMigration('development');
    await runPrismaMigration('production');
    console.log('\n✨ All migrations completed successfully.');
  } catch (error) {
    console.error('\n🛑 Migration process aborted due to errors.');
    process.exit(1);
  }
}

main();
