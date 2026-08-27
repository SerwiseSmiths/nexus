-- CreateTable
CREATE TABLE "ProviderBankAccount" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderBankAccount_providerProfileId_key" ON "ProviderBankAccount"("providerProfileId");

-- CreateIndex
CREATE INDEX "ProviderBankAccount_providerProfileId_idx" ON "ProviderBankAccount"("providerProfileId");

-- AddForeignKey
ALTER TABLE "ProviderBankAccount" ADD CONSTRAINT "ProviderBankAccount_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
