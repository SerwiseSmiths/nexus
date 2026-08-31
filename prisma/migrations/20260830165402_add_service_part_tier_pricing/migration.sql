-- CreateTable
CREATE TABLE "ServicePartTierPricing" (
    "id" TEXT NOT NULL,
    "servicePartId" TEXT NOT NULL,
    "providerTierId" TEXT NOT NULL,
    "salesPrice" DOUBLE PRECISION NOT NULL,
    "expense" DOUBLE PRECISION,
    "labour" DOUBLE PRECISION,
    "maxDiscount" DOUBLE PRECISION,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePartTierPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePartTierPricing_servicePartId_idx" ON "ServicePartTierPricing"("servicePartId");

-- CreateIndex
CREATE INDEX "ServicePartTierPricing_providerTierId_idx" ON "ServicePartTierPricing"("providerTierId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePartTierPricing_servicePartId_providerTierId_key" ON "ServicePartTierPricing"("servicePartId", "providerTierId");

-- AddForeignKey
ALTER TABLE "ServicePartTierPricing" ADD CONSTRAINT "ServicePartTierPricing_providerTierId_fkey" FOREIGN KEY ("providerTierId") REFERENCES "ProviderTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
