-- CreateTable: DeviceTypeGroup (created first so we can backfill into it
-- before the old Complaint/ProviderProfile columns are dropped below)
CREATE TABLE "DeviceTypeGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceTypes" "DeviceType"[] DEFAULT ARRAY[]::"DeviceType"[],
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceTypeGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceTypeGroup_isDeleted_idx" ON "DeviceTypeGroup"("isDeleted");

-- Seed one singleton group per existing DeviceType enum value, so every
-- device type belongs to a group from day one. Admins can later merge any of
-- these into shared multi-type groups via watchtower.
INSERT INTO "DeviceTypeGroup" ("id", "name", "deviceTypes", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Master Purifier',  ARRAY['MASTER_PURIFIER']::"DeviceType"[], now()),
  (gen_random_uuid()::text, 'Air Conditioner',  ARRAY['AIR_CONDITIONER']::"DeviceType"[], now()),
  (gen_random_uuid()::text, 'Fridge',           ARRAY['FRIDGE']::"DeviceType"[], now()),
  (gen_random_uuid()::text, 'Washing Machine',  ARRAY['WASHING_MACHINE']::"DeviceType"[], now()),
  (gen_random_uuid()::text, 'Geyser',           ARRAY['GEYSER']::"DeviceType"[], now());

-- CreateTable: ComplaintDevice (created before dropping Complaint.deviceId so
-- existing single-device links can be backfilled into it below)
CREATE TABLE "ComplaintDevice" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplaintDevice_complaintId_idx" ON "ComplaintDevice"("complaintId");
CREATE INDEX "ComplaintDevice_deviceId_idx" ON "ComplaintDevice"("deviceId");
CREATE UNIQUE INDEX "ComplaintDevice_complaintId_deviceId_key" ON "ComplaintDevice"("complaintId", "deviceId");

ALTER TABLE "ComplaintDevice" ADD CONSTRAINT "ComplaintDevice_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplaintDevice" ADD CONSTRAINT "ComplaintDevice_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing single device-per-complaint link becomes a
-- ComplaintDevice row.
INSERT INTO "ComplaintDevice" ("id", "complaintId", "deviceId")
SELECT gen_random_uuid()::text, "id", "deviceId"
FROM "Complaint"
WHERE "deviceId" IS NOT NULL;

-- CreateTable: provider <-> device-type-group many-to-many
CREATE TABLE "_ProviderSkillGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProviderSkillGroups_AB_pkey" PRIMARY KEY ("A", "B")
);

CREATE INDEX "_ProviderSkillGroups_B_index" ON "_ProviderSkillGroups"("B");

ALTER TABLE "_ProviderSkillGroups" ADD CONSTRAINT "_ProviderSkillGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "DeviceTypeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProviderSkillGroups" ADD CONSTRAINT "_ProviderSkillGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: each provider's old individual-DeviceType skills become their
-- (singleton, at this point) matching groups.
INSERT INTO "_ProviderSkillGroups" ("A", "B")
SELECT DISTINCT g."id", pp."id"
FROM "ProviderProfile" pp
CROSS JOIN LATERAL unnest(pp."skills") AS skill("deviceType")
JOIN "DeviceTypeGroup" g ON skill."deviceType" = ANY(g."deviceTypes")
WHERE pp."skills" IS NOT NULL;

-- AlterTable: add the new Complaint columns (still nullable — populated below)
ALTER TABLE "Complaint" ADD COLUMN "groupId" TEXT,
ADD COLUMN "requestedDevices" JSONB;

-- Backfill: derive each existing complaint's group from its old deviceKey,
-- and record what it was for as requestedDevices (quantity 1 — the old model
-- was always one device per complaint).
UPDATE "Complaint" c
SET "groupId" = g."id",
    "requestedDevices" = jsonb_build_array(jsonb_build_object('deviceKey', c."deviceKey", 'quantity', 1))
FROM "Device" d
JOIN "DeviceTypeGroup" g ON d."type" = ANY(g."deviceTypes")
WHERE c."deviceId" = d."id"
  AND c."deviceKey" IS NOT NULL;

-- DropForeignKey (old singular device link, now superseded by ComplaintDevice)
ALTER TABLE "Complaint" DROP CONSTRAINT "Complaint_deviceId_fkey";

-- AlterTable: drop the old singular device columns
ALTER TABLE "Complaint" DROP COLUMN "deviceId",
DROP COLUMN "deviceKey";

-- AlterTable: drop the old flat skills array (superseded by _ProviderSkillGroups)
ALTER TABLE "ProviderProfile" DROP COLUMN "skills";

-- CreateIndex
CREATE INDEX "Complaint_groupId_idx" ON "Complaint"("groupId");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DeviceTypeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
