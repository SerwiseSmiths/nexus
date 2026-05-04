# Nexus Feature Generator

Generate production-ready backend code for the **Nexus** Express + TypeScript project following its exact architecture and conventions.

**Usage:** `/nexus-feature <feature-name> [description]`
**Example:** `/nexus-feature booking "CRUD for service bookings"`

---

## Project Architecture

Always follow this layered structure for every new feature:

```
src/
├── controllers/   <feature>.controller.ts   ← HTTP layer, no business logic
├── services/      <feature>.service.ts      ← Business logic, Prisma calls
├── routes/        <feature>.route.ts        ← Express router + Swagger JSDoc
├── types/         <feature>.types.ts        ← Request/response TS interfaces
└── middlewares/   (reuse auth/authorize)
```

Register the new route in `src/routes/index.ts`.

---

## Core Conventions

### Naming
- **Files:** `kebab-case` — `auth.controller.ts`, `booking.service.ts`
- **Classes:** `PascalCase` — `BookingController`, `BookingService`
- **Methods:** `camelCase` static methods on classes
- **Prisma models:** `PascalCase` (match schema)
- **Enums:** Stored in `src/types/` or `prisma/schema.prisma`

### Imports
Always use path alias `@/` for src-relative imports:
```typescript
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import prisma from '@/services/prisma.service';
import { logger } from '@/utils/logger';
```

---

## Templates

### 1. Controller — `src/controllers/<feature>.controller.ts`

```typescript
import { NextFunction, Response } from 'express';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { <Feature>Service } from '@/services/<feature>.service';
import type { AuthRequest } from '@/middlewares/auth.middleware';

export class <Feature>Controller {
  static async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { fieldA, fieldB } = req.body as Create<Feature>Body;
      if (!fieldA || !fieldB) {
        throw new ApiError(400, 'fieldA and fieldB are required');
      }

      const result = await <Feature>Service.create({ fieldA, fieldB, userId: req.user!.id });

      res.status(201).json(ApiResponse.success('Created successfully', result));
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await <Feature>Service.findAll(req.user!.id);
      res.status(200).json(ApiResponse.success('Fetched successfully', items));
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const item = await <Feature>Service.findById(id, req.user!.id);
      res.status(200).json(ApiResponse.success('Fetched successfully', item));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const body = req.body as Update<Feature>Body;
      const updated = await <Feature>Service.update(id, body, req.user!.id);
      res.status(200).json(ApiResponse.success('Updated successfully', updated));
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await <Feature>Service.remove(id, req.user!.id);
      res.status(200).json(ApiResponse.success('Deleted successfully', null));
    } catch (error) {
      next(error);
    }
  }
}
```

**Rules:**
- Always `try/catch` and delegate errors to `next(error)`
- Validate required inputs at the top; throw `ApiError(400, ...)`
- Never use `res.send()` — always `res.status(N).json(ApiResponse.success(...))`
- Call service methods; do not touch Prisma directly
- Use `req.user!.id` for the authenticated user (middleware guarantees it when `authenticate` is applied)

---

### 2. Service — `src/services/<feature>.service.ts`

```typescript
import { ApiError } from '@/utils/apiResponse';
import prisma from '@/services/prisma.service';
import type { Create<Feature>Input, Update<Feature>Input } from '@/types/<feature>.types';

export class <Feature>Service {
  static async create(input: Create<Feature>Input) {
    return prisma.<model>.create({
      data: {
        ...input,
      },
    });
  }

  static async findAll(userId: string) {
    return prisma.<model>.findMany({
      where: { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async findById(id: string, userId: string) {
    const item = await prisma.<model>.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!item) throw new ApiError(404, '<Feature> not found');
    return item;
  }

  static async update(id: string, input: Update<Feature>Input, userId: string) {
    await <Feature>Service.findById(id, userId); // ownership check
    return prisma.<model>.update({
      where: { id },
      data: { ...input, updatedAt: new Date() },
    });
  }

  static async remove(id: string, userId: string) {
    await <Feature>Service.findById(id, userId); // ownership check
    return prisma.<model>.update({
      where: { id },
      data: { isDeleted: true },
    });
  }
}
```

**Rules:**
- Static methods only — no constructor, no `new`
- Throw `ApiError(statusCode, message)` for business errors; the global error handler catches them
- Soft-delete using `isDeleted: true` unless hard-delete is explicitly requested
- Always check ownership/existence before mutating
- Never return passwords, hashed values, or tokens from service methods

---

### 3. Route — `src/routes/<feature>.route.ts`

```typescript
import { Router } from 'express';
import { <Feature>Controller } from '@/controllers/<feature>.controller';
import { authenticate } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: <Feature>
 *   description: <Feature> management
 */

/**
 * @swagger
 * /<feature>s:
 *   post:
 *     summary: Create a new <feature>
 *     tags: [<Feature>]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fieldA
 *               - fieldB
 *             properties:
 *               fieldA:
 *                 type: string
 *               fieldB:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', authenticate, authorize([Role.CUSTOMER, Role.PROVIDER]), <Feature>Controller.create);

/**
 * @swagger
 * /<feature>s:
 *   get:
 *     summary: List all <feature>s for the current user
 *     tags: [<Feature>]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of <feature>s
 */
router.get('/', authenticate, <Feature>Controller.getAll);

/**
 * @swagger
 * /<feature>s/{id}:
 *   get:
 *     summary: Get <feature> by ID
 *     tags: [<Feature>]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: <Feature> found
 *       404:
 *         description: Not found
 */
router.get('/:id', authenticate, <Feature>Controller.getById);

/**
 * @swagger
 * /<feature>s/{id}:
 *   patch:
 *     summary: Update a <feature>
 *     tags: [<Feature>]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated successfully
 */
router.patch('/:id', authenticate, <Feature>Controller.update);

/**
 * @swagger
 * /<feature>s/{id}:
 *   delete:
 *     summary: Delete a <feature>
 *     tags: [<Feature>]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted successfully
 */
router.delete('/:id', authenticate, <Feature>Controller.remove);

export default router;
```

---

### 4. Types — `src/types/<feature>.types.ts`

```typescript
export interface Create<Feature>Body {
  fieldA: string;
  fieldB: string;
}

export interface Update<Feature>Body {
  fieldA?: string;
  fieldB?: string;
}

export interface Create<Feature>Input extends Create<Feature>Body {
  userId: string;
}

export interface Update<Feature>Input extends Update<Feature>Body {}
```

---

### 5. Prisma Model Addition — `prisma/schema.prisma`

```prisma
model <Feature> {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  fieldA    String
  fieldB    String
  isDeleted Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

Then add the reverse relation on `User`:
```prisma
// inside User model
<feature>s  <Feature>[]
```

Run migration:
```bash
yarn migrate:dev --name add_<feature>
```

---

### 6. Register Route — `src/routes/index.ts`

Add:
```typescript
import <feature>Routes from './<feature>.route';
// ...
router.use('/<feature>s', <feature>Routes);
```

---

## Utility Reference

### ApiResponse & ApiError — `src/utils/apiResponse.ts`

```typescript
// Success response
res.status(200).json(ApiResponse.success('message', data));
// → { statusCode: 200, success: true, message: '...', data: {...} }

// Error (throw anywhere, caught by errorHandler)
throw new ApiError(404, 'Not found');
throw new ApiError(400, 'Validation failed', { field: 'error detail' });
```

### Logger — `src/utils/logger.ts`

```typescript
import { logger } from '@/utils/logger';
logger.info('Something happened', { meta: 'value' });
logger.error('Something broke', { error });
```

### Prisma Singleton — `src/services/prisma.service.ts`

```typescript
import prisma from '@/services/prisma.service';
// Use directly: prisma.user.findMany(...)
```

---

## Role-Based Access

```typescript
import { authorize } from '@/middlewares/authorize.middleware';
import { Role } from '@prisma/client';

// Public (no auth)
router.get('/public', Controller.method);

// Any authenticated user
router.get('/', authenticate, Controller.method);

// Specific roles only
router.post('/admin-action', authenticate, authorize([Role.ADMIN]), Controller.method);
router.post('/provider-action', authenticate, authorize([Role.PROVIDER, Role.ADMIN]), Controller.method);
```

---

## Validation with Zod (for complex inputs)

When a route has many fields or complex validation, add a Zod schema:

```typescript
import { z } from 'zod';
import { ApiError } from '@/utils/apiResponse';

const createSchema = z.object({
  fieldA: z.string().min(1),
  fieldB: z.string().email(),
});

// In controller:
const parsed = createSchema.safeParse(req.body);
if (!parsed.success) {
  throw new ApiError(400, 'Validation failed', parsed.error.flatten());
}
const { fieldA, fieldB } = parsed.data;
```

---

## Response Format Contract

Every response must match this shape:
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Human-readable message",
  "data": { }
}
```

Error responses:
```json
{
  "statusCode": 404,
  "success": false,
  "message": "Resource not found",
  "data": null
}
```

---

## Checklist Before Finishing

- [ ] Controller uses try/catch + `next(error)` in every method
- [ ] Service throws `ApiError` (not generic `Error`) for known failure cases
- [ ] Route file has Swagger JSDoc for every endpoint
- [ ] Types file has `Body` (req.body shape) and `Input` (service layer shape) interfaces
- [ ] Prisma model has `isDeleted`, `createdAt`, `updatedAt`, and an index on foreign keys
- [ ] Route registered in `src/routes/index.ts`
- [ ] No raw `console.log` — use `logger`
- [ ] No `any` types — use strict TypeScript

---

## Task

The user has requested: **$ARGUMENTS**

Generate all necessary files for this feature following the templates and conventions above. Create the actual TypeScript files with real field names derived from the feature description — do not leave `<Feature>` placeholders in the output files. After generating all files, show the route registration snippet to add to `src/routes/index.ts`.
