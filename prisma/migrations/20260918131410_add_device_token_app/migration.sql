-- CreateEnum
CREATE TYPE "DeviceApp" AS ENUM ('SERWISE', 'RADIX');

-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN     "app" "DeviceApp";
