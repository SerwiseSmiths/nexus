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

### Living feature docs (`docs/*.md`)
Before touching `auth`, `device`, or `complaint` code, read the matching doc in `docs/` (`authentication.md`, `device.md`, `complaint.md`) — they track known gaps, fixed bugs, the full endpoint/state-machine reference, and a change log for that module. Update the relevant doc's Change Log + Known Gaps sections whenever you ship a feature or fix a bug in that module — these are meant to stay current, not be written once and abandoned.

### Established patterns worth reusing
- **Audit trail on a mutation**: if a feature needs a dated history of what happened (see `complaint.md` §6.5's `ComplaintLog`), write the log row **synchronously, inline**, never via the fire-and-forget `emit()` helper used for notifications/realtime — a log entry recording a state change is part of that change, not a best-effort side effect safe to drop.
- **Snapshotting externally-editable data (CMS prices, etc.) at creation time**: re-resolve the current value from its source of truth at the moment of creation and write the resolved value into the row being created (plain `Json`/scalar column) — never a live reference/foreign lookup a later read would have to re-resolve. See `complaint.md` §6.2 (`addQuote`'s CMS price snapshot) for the concrete pattern, including how to still allow an explicit manual override (§6.3) without reopening the whole guarantee.
- **A background sweep that mutates rows another request-path can also mutate concurrently**: gate the sweep's actual write with the same condition its initial read used (e.g. `updateMany({ where: { id, <still-true-flag>: true }, ... })`, check the returned count), not just the read — otherwise the sweep can silently clobber a change a concurrent request just made. See `complaint.md` §5.1's assignment-deadline sweep.
