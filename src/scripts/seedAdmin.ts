import { PrismaClient, Role } from '@prisma/client';
import { initializeConfig } from '../configs';

async function seedAdmin(stage: 'development' | 'production') {
  console.log(`\n🚀 Seeding ADMIN to environment: ${stage.toUpperCase()}`);
  
  process.env.NODE_ENV = stage;
  
  try {
    const config = await initializeConfig();
    
    const dbUrl = config.directUrl || config.databaseUrl;
    if (!dbUrl) {
      throw new Error(`Missing databaseUrl or directUrl for ${stage} in Remote Config.`);
    }

    // Set for Prisma Client
    process.env.DATABASE_URL = dbUrl;
    const prisma = new PrismaClient();

    const user = await prisma.user.upsert({
      where: { phoneNo: '7016301938' },
      update: {
        firstName: 'Mann',
        lastName: 'Patel',
        role: Role.ADMIN,
        isActive: true,
      },
      create: {
        phoneNo: '7016301938',
        firstName: 'Mann',
        lastName: 'Patel',
        role: Role.ADMIN,
        isActive: true,
      },
    });

    console.log(`✅ Admin user upserted successfully in ${stage}:`, user.id);
    await prisma.$disconnect();
  } catch (error: any) {
    console.error(`❌ Seeding failed for ${stage}:`, error.message);
    throw error;
  }
}

async function main() {
  try {
    await seedAdmin('development');
    await seedAdmin('production');
    console.log('\n✨ All seed operations completed successfully.');
  } catch (error) {
    console.error('\n🛑 Seeding process aborted due to errors.');
    process.exit(1);
  }
}

main();
