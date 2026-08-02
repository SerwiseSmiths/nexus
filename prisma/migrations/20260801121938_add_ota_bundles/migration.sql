-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "should_force_update" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "file_hash" TEXT NOT NULL,
    "git_commit_hash" TEXT,
    "message" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'production',
    "storage_uri" TEXT NOT NULL,
    "target_app_version" TEXT,
    "fingerprint_hash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "rollout_cohort_count" INTEGER NOT NULL DEFAULT 1000,
    "target_cohorts" JSONB,
    "manifest_storage_uri" TEXT,
    "manifest_file_hash" TEXT,
    "asset_base_storage_uri" TEXT,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_patches" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "base_bundle_id" TEXT NOT NULL,
    "base_file_hash" TEXT NOT NULL,
    "patch_file_hash" TEXT NOT NULL,
    "patch_storage_uri" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bundle_patches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bundles_target_app_version_idx" ON "bundles"("target_app_version");

-- CreateIndex
CREATE INDEX "bundles_fingerprint_hash_idx" ON "bundles"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "bundles_channel_idx" ON "bundles"("channel");

-- CreateIndex
CREATE INDEX "bundles_rollout_cohort_count_idx" ON "bundles"("rollout_cohort_count");

-- CreateIndex
CREATE INDEX "bundle_patches_bundle_id_idx" ON "bundle_patches"("bundle_id");

-- CreateIndex
CREATE INDEX "bundle_patches_base_bundle_id_idx" ON "bundle_patches"("base_bundle_id");

-- AddForeignKey
ALTER TABLE "bundle_patches" ADD CONSTRAINT "bundle_patches_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
