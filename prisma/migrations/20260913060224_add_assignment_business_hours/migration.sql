-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "assignmentDeadline" TIMESTAMP(3),
ADD COLUMN     "assignmentPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Complaint_assignmentPending_assignmentDeadline_idx" ON "Complaint"("assignmentPending", "assignmentDeadline");
