-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MASTER_PURIFIER', 'AIR_CONDITIONER', 'FRIDGE', 'WASHING_MACHINE');

-- CreateEnum
CREATE TYPE "WorkHistoryEvent" AS ENUM ('PURCHASED', 'INSTALLED', 'REPAIR', 'INSPECTION', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "ComplaintStage" AS ENUM ('ENTRANCE', 'QR_VALIDATED', 'ESTIMATION', 'APPROVAL', 'PAYMENT', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SERVICE', 'COMPLAINT', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "imageUrl" TEXT,
    "metadata" JSONB NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceWorkHistory" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "event" "WorkHistoryEvent" NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceWorkHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT,
    "addressId" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceKey" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "stage" "ComplaintStage" NOT NULL DEFAULT 'ENTRANCE',
    "providerAccepted" BOOLEAN NOT NULL DEFAULT false,
    "providerAcceptedAt" TIMESTAMP(3),
    "rejectedProviderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entryQrToken" TEXT,
    "entryQrExpiresAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "parentId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintMedia" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplaintMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "complaintId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SERVICE',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_userId_isDeleted_idx" ON "Device"("userId", "isDeleted");

-- CreateIndex
CREATE INDEX "Device_deviceKey_idx" ON "Device"("deviceKey");

-- CreateIndex
CREATE INDEX "DeviceWorkHistory_deviceId_isDeleted_idx" ON "DeviceWorkHistory"("deviceId", "isDeleted");

-- CreateIndex
CREATE INDEX "DeviceWorkHistory_deviceId_event_idx" ON "DeviceWorkHistory"("deviceId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_entryQrToken_key" ON "Complaint"("entryQrToken");

-- CreateIndex
CREATE INDEX "Complaint_userId_isDeleted_idx" ON "Complaint"("userId", "isDeleted");

-- CreateIndex
CREATE INDEX "Complaint_providerId_isDeleted_idx" ON "Complaint"("providerId", "isDeleted");

-- CreateIndex
CREATE INDEX "Complaint_stage_idx" ON "Complaint"("stage");

-- CreateIndex
CREATE INDEX "Complaint_parentId_idx" ON "Complaint"("parentId");

-- CreateIndex
CREATE INDEX "Complaint_entryQrToken_idx" ON "Complaint"("entryQrToken");

-- CreateIndex
CREATE INDEX "ComplaintMedia_complaintId_idx" ON "ComplaintMedia"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_complaintId_key" ON "Quote"("complaintId");

-- CreateIndex
CREATE INDEX "Quote_complaintId_idx" ON "Quote"("complaintId");

-- CreateIndex
CREATE INDEX "Notification_userId_isDeleted_idx" ON "Notification"("userId", "isDeleted");

-- CreateIndex
CREATE INDEX "Notification_complaintId_idx" ON "Notification"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE INDEX "DeviceToken_token_idx" ON "DeviceToken"("token");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceWorkHistory" ADD CONSTRAINT "DeviceWorkHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintMedia" ADD CONSTRAINT "ComplaintMedia_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
