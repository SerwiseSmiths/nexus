/**
 * Cache tags for CMS content cached from watchtower (see strapi.service.ts +
 * cache.service.ts). Values match watchtower's own content-type UIDs exactly
 * (watchtower/src/lib/db/entity-repository.ts's `contentTag`/`contentTypeUid`,
 * and the `uid` implied by each schema under watchtower/content-schemas/api/*)
 * so the invalidation request watchtower sends (POST /cache/invalidate with
 * `{ tags: [contentTypeUid] }`) needs no translation on either side.
 */
export const CACHE_TAGS = {
  DEVICE_TYPES: 'api::device-type.device-type',
  SUBSCRIPTION_PLANS: 'api::subscription-plan.subscription-plan',
  SUBSCRIPTION_ADDONS: 'api::subscription-addon.subscription-addon',
  SERVICE_PARTS: 'api::service-part.service-part',
  WELCOME_BONUS: 'api::welcome-bonus.welcome-bonus',
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];
