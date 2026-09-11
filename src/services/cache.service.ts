import { logger } from '@/utils/logger';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tags: string[];
}

/**
 * In-memory TTL + tag cache for read-mostly CMS content (see strapi.service.ts).
 * Nexus runs as a single long-lived process (not a serverless/multi-instance
 * deploy), so a process-local Map is enough — no Redis needed. If nexus is
 * ever scaled to multiple instances, this must move to a shared store (Redis)
 * since invalidation would otherwise only clear one instance's cache.
 */
export class CacheService {
  private static store = new Map<string, CacheEntry<unknown>>();
  private static tagIndex = new Map<string, Set<string>>();

  static async getOrSet<T>(key: string, ttlSeconds: number, tags: string[], fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await fetcher();
    this.set(key, value, ttlSeconds, tags);
    return value;
  }

  /** Returns `undefined` on a cache miss/expiry — distinguishable from a cached `null`. */
  static get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit || hit.expiresAt <= Date.now()) return undefined;
    return hit.value as T;
  }

  static set<T>(key: string, value: T, ttlSeconds: number, tags: string[]): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, tags });
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(key);
    }
  }

  /** Drops every cached entry carrying `tag` (e.g. a content-type UID such as
   *  `api::device-type.device-type`) — called when watchtower reports a write. */
  static invalidateTag(tag: string): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    for (const key of keys) this.store.delete(key);
    this.tagIndex.delete(tag);
    logger.info(`[Cache] Invalidated tag "${tag}" (${keys.size} key(s))`);
  }

  static clearAll(): void {
    this.store.clear();
    this.tagIndex.clear();
    logger.info('[Cache] Cleared all entries');
  }
}
