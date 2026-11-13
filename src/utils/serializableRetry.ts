import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

// Runs `fn` (which must open its own Serializable transaction) and retries it
// when Postgres aborts it with a serialization failure (Prisma P2034). The
// aborted attempt rolled back completely, so re-running it is safe — and
// without a retry, a webhook path would turn a momentary write conflict into
// a permanently FAILED payment (Razorpay's own retries are ignored once the
// order has left PENDING).
export async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 4,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const conflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (!conflict || attempt >= attempts) throw err;
      logger.warn(`[${label}] Serialization conflict, retrying`, { attempt });
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.floor(Math.random() * 50)));
    }
  }
}
