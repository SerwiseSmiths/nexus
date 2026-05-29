-- AlterEnum
ALTER TYPE "DeviceType" ADD VALUE 'GEYSER';

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "addressId" TEXT;

-- CreateIndex
CREATE INDEX "Device_addressId_idx" ON "Device"("addressId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
