/*
  Warnings:

  - You are about to drop the column `deviceId` on the `Subscription` table. All the data in the column will be lost.
  - Added the required column `deviceTypeKey` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_deviceId_fkey";

-- DropIndex
DROP INDEX "Subscription_deviceId_status_idx";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "deviceId",
ADD COLUMN     "deviceTypeKey" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Subscription_userId_deviceTypeKey_status_idx" ON "Subscription"("userId", "deviceTypeKey", "status");
