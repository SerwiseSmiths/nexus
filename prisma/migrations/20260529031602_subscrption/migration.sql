-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('ANNUAL', 'MONTHLY');

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "planPrice" DOUBLE PRECISION NOT NULL,
    "addons" JSONB NOT NULL DEFAULT '[]',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "maxServices" INTEGER NOT NULL,
    "servicesUsed" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionService" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "visitNumber" INTEGER NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "complaintId" TEXT,
    "serviceKeys" JSONB NOT NULL DEFAULT '[]',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_userId_isDeleted_idx" ON "Subscription"("userId", "isDeleted");

-- CreateIndex
CREATE INDEX "Subscription_deviceId_status_idx" ON "Subscription"("deviceId", "status");

-- CreateIndex
CREATE INDEX "Subscription_status_endDate_idx" ON "Subscription"("status", "endDate");

-- CreateIndex
CREATE INDEX "SubscriptionService_subscriptionId_idx" ON "SubscriptionService"("subscriptionId");

-- CreateIndex
CREATE INDEX "Complaint_subscriptionId_idx" ON "Complaint"("subscriptionId");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionService" ADD CONSTRAINT "SubscriptionService_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
