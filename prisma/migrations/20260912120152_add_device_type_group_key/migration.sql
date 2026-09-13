-- Add "key" as nullable first so existing rows can be backfilled before the
-- NOT NULL + UNIQUE constraints are enforced.
ALTER TABLE "DeviceTypeGroup" ADD COLUMN "key" TEXT;

-- Backfill from name, slugified (lowercase, non-alphanumeric runs -> "_",
-- trimmed). Deduplicated by createdAt order in the rare case two group names
-- slugify to the same value.
WITH slugged AS (
  SELECT
    id,
    lower(regexp_replace(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'), '^_+|_+$', '', 'g')) AS base_key,
    row_number() OVER (
      PARTITION BY lower(regexp_replace(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'))
      ORDER BY "createdAt"
    ) AS rn
  FROM "DeviceTypeGroup"
)
UPDATE "DeviceTypeGroup" g
SET "key" = CASE WHEN s.rn = 1 THEN s.base_key ELSE s.base_key || '_' || s.rn END
FROM slugged s
WHERE g.id = s.id;

-- Now that every row has a key, enforce the real constraints.
ALTER TABLE "DeviceTypeGroup" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "DeviceTypeGroup_key_key" ON "DeviceTypeGroup"("key");
