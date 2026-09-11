import { Response, NextFunction } from 'express';
import { ApiResponse, ApiError } from '@/utils/apiResponse';
import { CacheService } from '@/services/cache.service';
import { CACHE_TAGS } from '@/constants/cache-tags';
import type { AuthRequest } from '@/middlewares/auth.middleware';

const VALID_TAGS = new Set<string>(Object.values(CACHE_TAGS));

export class CacheController {
  static async invalidate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tags } = req.body ?? {};

      if (!Array.isArray(tags) || tags.length === 0 || !tags.every((t) => typeof t === 'string')) {
        throw new ApiError(400, 'Request body must include a non-empty "tags" array of strings');
      }

      const unknown = tags.filter((t) => !VALID_TAGS.has(t));
      if (unknown.length > 0) {
        throw new ApiError(400, `Unknown cache tag(s): ${unknown.join(', ')}`);
      }

      for (const tag of tags) CacheService.invalidateTag(tag);

      ApiResponse.success(res, 200, 'Cache invalidated', { tags });
    } catch (error) {
      next(error);
    }
  }
}
