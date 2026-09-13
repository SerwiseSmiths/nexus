-- CreateTable
CREATE TABLE "ComplaintLog" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "fromStage" "ComplaintStage",
    "toStage" "ComplaintStage",
    "actorId" TEXT,
    "actorRole" "Role",
    "metadata" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplaintLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplaintLog_complaintId_isDeleted_idx" ON "ComplaintLog"("complaintId", "isDeleted");

-- AddForeignKey
ALTER TABLE "ComplaintLog" ADD CONSTRAINT "ComplaintLog_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
