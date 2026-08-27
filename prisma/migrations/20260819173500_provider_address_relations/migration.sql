-- AlterTable
ALTER TABLE "User" DROP COLUMN "aadharAddress",
DROP COLUMN "currentAddress",
ADD COLUMN     "aadharAddressId" TEXT,
ADD COLUMN     "currentAddressId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_currentAddressId_key" ON "User"("currentAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "User_aadharAddressId_key" ON "User"("aadharAddressId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_currentAddressId_fkey" FOREIGN KEY ("currentAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_aadharAddressId_fkey" FOREIGN KEY ("aadharAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
