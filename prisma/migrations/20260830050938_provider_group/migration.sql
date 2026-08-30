-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "providerTierId" TEXT;

-- CreateTable
CREATE TABLE "ProviderTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "color" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderProfile_providerTierId_idx" ON "ProviderProfile"("providerTierId");

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_providerTierId_fkey" FOREIGN KEY ("providerTierId") REFERENCES "ProviderTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
