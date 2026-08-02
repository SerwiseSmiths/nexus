/**
 * Builds a synthetic bundle-id floor for an arbitrary timestamp, using the
 * exact same encoding as hot-updater's own `generateMinBundleId()`
 * (@hot-updater/plugin-core) — verified by reading its compiled source
 * (node_modules/@hot-updater/plugin-core/dist/generateMinBundleId.cjs).
 * Real bundle ids are UUIDv7 (createUUIDv7): the high 32 bits of the 48-bit
 * millisecond timestamp fill the first hex group, the low 16 bits fill the
 * second. generateMinBundleId() packs Date.now() the same way with all
 * random bits zeroed, making it the lexicographically-lowest possible UUIDv7
 * for that millisecond — a correct inclusive floor when compared as plain
 * strings (Postgres `id >= floor`), which is exactly how the Prisma adapter's
 * getUpdateInfo() filters bundles.
 */
export const computeMinBundleIdForDate = (timestampMs: number): string => {
  const timestamp = BigInt(timestampMs);
  const timeHigh = Number((timestamp >> 16n) & 4294967295n);
  const timeLow = Number(timestamp & 65535n);
  return `${timeHigh.toString(16).padStart(8, '0')}-${timeLow.toString(16).padStart(4, '0')}-7000-8000-000000000000`;
};
