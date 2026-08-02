import { createUniversalStoragePlugin } from '@hot-updater/plugin-core';
import fs from 'fs/promises';
import { cloudinary } from '@/configs/cloudinary.config';
import { logger } from '@/utils/logger';

const BUCKET = 'ota-bundles';
const RESOURCE_TYPE = 'raw' as const;
const DELIVERY_TYPE = 'authenticated' as const;
const SIGNED_URL_TTL_SECONDS = 3600;

const publicIdFor = (key: string) => `${BUCKET}/${key}`;

const parseCloudinaryUri = (storageUri: string) => {
  const withoutProtocol = storageUri.replace(/^cloudinary:\/\//, '');
  if (withoutProtocol === storageUri) {
    throw new Error(`Invalid storage URI protocol, expected "cloudinary://": ${storageUri}`);
  }
  return { publicId: withoutProtocol };
};

const isNotFoundError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'http_code' in error &&
  (error as { http_code?: number }).http_code === 404;

const getSignedDownloadUrl = (publicId: string) =>
  cloudinary.utils.private_download_url(publicId, '', {
    resource_type: RESOURCE_TYPE,
    type: DELIVERY_TYPE,
    expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
  });

/**
 * hot-updater storage plugin backed by Cloudinary, in place of hot-updater's
 * AWS S3 reference implementation. Modeled on hot-updater's own supabaseStorage
 * plugin (@hot-updater/supabase) — see d:\Serwise-bundle\ota-migration\TRACKING.md
 * for the source this was verified against.
 *
 * `node` profile is used by our own /ota/admin/storage/* proxy routes
 * (ota.route.ts) on behalf of the CLI's `standaloneStorage` adapter; `runtime`
 * profile is used directly by createHotUpdater's public check-update handler.
 */
export const cloudinaryStorage = createUniversalStoragePlugin<Record<string, never>>({
  name: 'cloudinaryStorage',
  supportedProtocol: 'cloudinary',
  factory: () => ({
    node: {
      async upload(key, filePath) {
        const publicId = publicIdFor(key);
        const result = await cloudinary.uploader.upload(filePath, {
          public_id: publicId,
          resource_type: RESOURCE_TYPE,
          type: DELIVERY_TYPE,
          use_filename: false,
          unique_filename: false,
          overwrite: true,
        });

        if (!result.public_id) {
          throw new Error(`Failed to upload OTA bundle "${key}" to Cloudinary`);
        }

        return { storageUri: `cloudinary://${publicId}` };
      },

      async delete(storageUri) {
        const { publicId } = parseCloudinaryUri(storageUri);
        try {
          await cloudinary.uploader.destroy(publicId, {
            resource_type: RESOURCE_TYPE,
            type: DELIVERY_TYPE,
          });
        } catch (error) {
          if (isNotFoundError(error)) {
            throw new Error('Bundle not found');
          }
          throw error;
        }
      },

      async exists(storageUri) {
        const { publicId } = parseCloudinaryUri(storageUri);
        try {
          await cloudinary.api.resource(publicId, {
            resource_type: RESOURCE_TYPE,
            type: DELIVERY_TYPE,
          });
          return true;
        } catch (error) {
          if (isNotFoundError(error)) {
            return false;
          }
          throw error;
        }
      },

      async downloadFile(storageUri, filePath) {
        const { publicId } = parseCloudinaryUri(storageUri);
        const signedUrl = getSignedDownloadUrl(publicId);
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Failed to download bundle: ${response.status} ${response.statusText}`);
        }
        await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      },
    },

    runtime: {
      async getDownloadUrl(storageUri) {
        const { publicId } = parseCloudinaryUri(storageUri);
        return { fileUrl: getSignedDownloadUrl(publicId) };
      },

      async readText(storageUri) {
        const { publicId } = parseCloudinaryUri(storageUri);
        const signedUrl = getSignedDownloadUrl(publicId);
        try {
          const response = await fetch(signedUrl);
          if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`Failed to read OTA storage text: ${response.status} ${response.statusText}`);
          }
          return await response.text();
        } catch (error) {
          logger.warn('[otaCloudinaryStorage] readText failed', error);
          return null;
        }
      },
    },
  }),
});
