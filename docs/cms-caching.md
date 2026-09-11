# CMS content caching + invalidation

Nexus caches every read it makes to watchtower's Strapi-compatible CMS endpoints
(`StrapiService`, `src/services/strapi.service.ts`) in an in-memory, tag-based cache
(`src/services/cache.service.ts`). Watchtower calls nexus back on every content write so the
cache clears immediately instead of waiting out its TTL.

## Why in-memory, not Redis

Nexus runs as a single long-lived process (one instance — see the OTA/hot-updater memory
note: both radix and serwise channels already got consolidated onto one nexus instance for
the same reason). A process-local `Map` is enough for that topology and needs no new infra.
**If nexus is ever scaled to multiple instances, this must move to a shared store (e.g.
Redis)** — otherwise an invalidation call only clears whichever instance happens to receive
it, and the others keep serving stale data until their TTL expires.

## Cache key / tag mapping

Each entry is stored under a request-shaped key, tagged with the CMS content-type UID it
came from. Invalidating a tag drops every key that carries it.

| CMS content (watchtower content-type UID)         | Cache tag (= UID, no translation)              | Cache key(s)                              | `StrapiService` method(s)                          |
|----------------------------------------------------|-------------------------------------------------|--------------------------------------------|-----------------------------------------------------|
| Device types                                        | `api::device-type.device-type`                 | `strapi:deviceTypes`                      | `fetchDeviceTypes`                                  |
| Subscription plans                                  | `api::subscription-plan.subscription-plan`     | `strapi:subscriptionPlans`                | `fetchSubscriptionPlans`                            |
| Subscription addons                                 | `api::subscription-addon.subscription-addon`   | `strapi:subscriptionAddons:all`           | `fetchSubscriptionAddons` (filtered client-side by `deviceTypeKey` after the cached fetch) |
| Service parts (catalogue)                           | `api::service-part.service-part`               | `strapi:parts:all`, `strapi:parts:byId:<documentId>` | `fetchParts` (filtered client-side by `deviceType`), `fetchPartByDocumentId` |
| Welcome bonus (singleton)                           | `api::welcome-bonus.welcome-bonus`             | `strapi:welcomeBonus`                     | `fetchWelcomeBonus`                                 |

Tag constants live in `src/constants/cache-tags.ts` (`CACHE_TAGS`) and are the single source
of truth — the values there **must stay byte-identical** to the content-type UIDs used by
watchtower's own `contentTag()` (`watchtower/src/lib/db/entity-repository.ts`), since no
translation happens on either side.

Notes:
- `fetchParts`/`fetchSubscriptionAddons` always cache the **unfiltered** list once and filter
  by `deviceType`/`deviceTypeKey` after reading from cache, so every caller shares one entry
  regardless of which filter it asked for.
- `fetchPartByDocumentId` deliberately bypasses the generic `getOrSet` helper — a `null`
  ("not found") result is never cached, so a transient miss can't freeze a false negative for
  a full TTL.
- `fetchWelcomeBonus` swallows CMS errors and returns `null` (pre-existing behavior); a failed
  fetch is never cached either.

## TTL fallback

`CACHE_TTL_SECONDS` (env var, default `300`) is a backstop only. Every cache entry self-heals
after this many seconds even if watchtower's invalidation call is somehow missed (nexus
restarted mid-flight and lost the in-memory cache instance-side state doesn't matter here
either, since a cold process starts with an empty cache anyway).

## Invalidation flow

1. An admin edits content in watchtower (create / update / delete / publish — `unpublish`
   goes through `deleteEntity` internally, so it's covered too).
2. `entity-repository.ts` already calls `revalidateTag(contentTag(contentTypeUid), ...)` for
   watchtower's own Next.js cache. Right after that, it now also calls
   `notifyNexusCacheInvalidation(contentTypeUid)`
   (`watchtower/src/lib/nexus/cache-invalidation.ts`).
3. That helper no-ops for any content type nexus doesn't cache, and otherwise fires
   (fire-and-forget, not awaited) `POST {NEXUS_API_URL}/cache/invalidate` with
   `{ "tags": ["<contentTypeUid>"] }`, authenticated the same way every other
   watchtower→nexus admin call is (`nexusFetch` — a short-lived signed `ADMIN`-role JWT via
   `NEXUS_JWT_SECRET`). No new shared secret was introduced.
4. Nexus's route (`POST /cache/invalidate`, `src/routes/cache.route.ts`, gated by the existing
   `authenticate` + `authorize([Role.ADMIN])` middleware — same as `/complaint` and other
   watchtower-facing admin endpoints) validates the tags against `CACHE_TAGS` and calls
   `CacheService.invalidateTag(tag)` for each one.
5. A failure anywhere in step 3 (nexus down, auth mismatch) is caught and logged — it never
   blocks or fails the write, which has already committed to watchtower's own DB. The TTL
   fallback above covers this case.

## Adding a new cached content type

1. Add the UID to `CACHE_TAGS` in `nexus/src/constants/cache-tags.ts`.
2. Wrap the new `StrapiService` fetch method with `CacheService.getOrSet(key, config.cache.ttlSeconds, [tag], fetcher)`
   (see any existing method in `strapi.service.ts` for the pattern).
3. Add the same UID string to `NEXUS_CACHED_CONTENT_TYPES` in
   `watchtower/src/lib/nexus/cache-invalidation.ts`.
4. Update the mapping table above.
