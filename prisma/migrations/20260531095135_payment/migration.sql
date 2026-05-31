-- CreateEnum
CREATE TYPE "PaymentSessionStatus" AS ENUM ('PENDING', 'FULFILLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "PaymentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expectedAmountPaise" INTEGER NOT NULL,
    "meta" JSONB NOT NULL,
    "status" "PaymentSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentSession_phone_status_idx" ON "PaymentSession"("phone", "status");

-- CreateIndex
CREATE INDEX "PaymentSession_userId_status_idx" ON "PaymentSession"("userId", "status");

-- CreateIndex
CREATE INDEX "PaymentSession_expiresAt_idx" ON "PaymentSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
