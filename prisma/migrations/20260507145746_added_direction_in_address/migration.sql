-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "directionNote" TEXT,
ALTER COLUMN "pinCode" DROP NOT NULL,
ALTER COLUMN "city" DROP NOT NULL;
