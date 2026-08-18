-- AlterTable
ALTER TABLE "User" ADD COLUMN     "skills" "DeviceType"[] DEFAULT ARRAY[]::"DeviceType"[];
