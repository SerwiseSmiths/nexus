-- CreateEnum
CREATE TYPE "ProviderSignupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ProviderSignupRequest" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phoneNo" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "deviceTypes" "DeviceType"[],
    "experienceYears" INTEGER,
    "status" "ProviderSignupStatus" NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "providerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderSignupRequest_phoneNo_status_idx" ON "ProviderSignupRequest"("phoneNo", "status");

-- CreateIndex
CREATE INDEX "ProviderSignupRequest_status_createdAt_idx" ON "ProviderSignupRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProviderSignupRequest_providerId_idx" ON "ProviderSignupRequest"("providerId");
