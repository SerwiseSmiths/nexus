# Nexus — Claude Instructions

## Code Writing Rule

**Whenever you write any backend code for this project, you MUST follow the conventions defined in `.claude/commands/nexus-feature.md` without being asked.**

This applies to:
- New features (controllers, services, routes, types, Prisma models)
- Modifications to existing files
- Bug fixes that touch the service or controller layer
- Any new route, middleware, or utility

## Quick Reference

### Layer Responsibilities
| Layer | File | Rule |
|---|---|---|
| Controller | `src/controllers/<feature>.controller.ts` | HTTP only — validate input, call service, return `ApiResponse` |
| Service | `src/services/<feature>.service.ts` | Business logic + Prisma — throw `ApiError` on failures |
| Route | `src/routes/<feature>.route.ts` | Router + Swagger JSDoc on every endpoint |
| Types | `src/types/<feature>.types.ts` | `Body` interfaces (req.body) + `Input` interfaces (service args) |

### Non-Negotiable Patterns
- All imports use `@/` path alias (e.g. `@/utils/apiResponse`)
- Controllers: every method is `static async`, always `try/catch` + `next(error)`
- Services: every method is `static`, throw `ApiError(statusCode, message)` — never raw `Error`
- Responses: always `res.status(N).json(ApiResponse.success(message, data))`
- Soft-delete: `isDeleted: true` via Prisma update — never hard-delete unless explicitly asked
- No `console.log` — use `logger` from `@/utils/logger`
- No `any` types — strict TypeScript throughout
- New Prisma models: must have `id` (uuid), `isDeleted`, `createdAt`, `updatedAt`, and `@@index` on FK fields
- New routes: must be registered in `src/routes/index.ts`
- Every route file must have Swagger JSDoc (`@swagger`) for each endpoint

### Auth & Roles
```typescript
import { authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

router.get('/', authenticate, Controller.method);                              // any auth user
router.post('/', authenticate, authorize([Role.ADMIN]), Controller.method);   // role-gated
```

### Error Handling
```typescript
throw new ApiError(400, 'message');          // known business errors in services
throw new ApiError(404, 'Not found');
// In controllers: catch and pass to next(error) — never swallow errors
```

### Response Shape
```typescript
ApiResponse.success('message', data)   // → { statusCode, success: true, message, data }
// Errors handled automatically by errorHandler middleware
```
