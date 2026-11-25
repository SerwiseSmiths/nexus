-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('DELIVERED', 'DISPLAYED', 'OPENED', 'ACCEPTED', 'REJECTED', 'DISMISSED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "NotificationEventSource" AS ENUM ('NATIVE', 'NOTIFEE', 'APP', 'SERVER');

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "userId" TEXT NOT NULL,
    "complaintId" TEXT,
    "event" "NotificationEventType" NOT NULL,
    "source" "NotificationEventSource" NOT NULL,
    "meta" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationEvent_userId_occurredAt_idx" ON "NotificationEvent"("userId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationEvent_complaintId_idx" ON "NotificationEvent"("complaintId");

-- CreateIndex
CREATE INDEX "NotificationEvent_event_occurredAt_idx" ON "NotificationEvent"("event", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_notificationId_event_key" ON "NotificationEvent"("notificationId", "event");

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
