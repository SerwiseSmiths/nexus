-- CreateTable
CREATE TABLE "ProviderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skills" "DeviceType"[] DEFAULT ARRAY[]::"DeviceType"[],
    "currentAddressId" TEXT,
    "aadharAddressId" TEXT,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProfile_pkey" PRIMARY KEY ("id")
);

-- Backfill from User before its provider-only columns are dropped below.
INSERT INTO "ProviderProfile" ("id", "userId", "skills", "currentAddressId", "aadharAddressId", "adminNotes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "skills", "currentAddressId", "aadharAddressId", "adminNotes", now(), now()
FROM "User"
WHERE "role" = 'PROVIDER';

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_aadharAddressId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_currentAddressId_fkey";

-- DropIndex
DROP INDEX "User_aadharAddressId_key";

-- DropIndex
DROP INDEX "User_currentAddressId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "aadharAddressId",
DROP COLUMN "adminNotes",
DROP COLUMN "currentAddressId",
DROP COLUMN "skills";

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_userId_key" ON "ProviderProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_currentAddressId_key" ON "ProviderProfile"("currentAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_aadharAddressId_key" ON "ProviderProfile"("aadharAddressId");

-- CreateIndex
CREATE INDEX "ProviderProfile_userId_idx" ON "ProviderProfile"("userId");

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_currentAddressId_fkey" FOREIGN KEY ("currentAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_aadharAddressId_fkey" FOREIGN KEY ("aadharAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
