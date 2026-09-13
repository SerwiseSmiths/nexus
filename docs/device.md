# Device Module — Feature Reference

Living reference for device (appliance) management, shared by **serwise** (consumer, self-service devices) and **radix** (provider, on-behalf-of-customer devices), both backed by this **nexus** service. Read this before touching device code — same purpose as `docs/authentication.md`: hold everything so nothing gets missed across sessions.

Last verified against the codebase: 2026-09-07.

---

## 1. Scope & Design

- A **`Device`** is a user-owned appliance record (e.g. a specific fridge or AC unit), not a catalog entry. It belongs to exactly one `User`, optionally to one `Address`.
- **`DeviceType` is not a database table.** It's a Prisma **enum** (`MASTER_PURIFIER | AIR_CONDITIONER | FRIDGE | WASHING_MACHINE | GEYSER`) used for coarse categorization on the `Device` row. The actual browsable catalog (labels, icons) is fetched live from **Strapi** via `GET /device-types` — don't confuse the two when extending this module.
- **`deviceKey`** (e.g. `air_conditioner`) is the real identity of "what kind of device this is" — it's a string slug that both maps to a Strapi content-type and selects which Zod metadata schema validates the device's `metadata` JSON blob. It's set once at creation and immutable afterward (no route accepts changing it).
- **Two ownership paths to the same table:**
  - **Consumer (serwise):** `POST /device` — the caller adds their own device. Ownership is implicit (`req.user.id`).
  - **Provider (radix/admin):** `POST /device/for-customer` + `GET /device/customer/:userId` — a provider adds/reads devices *for a customer*, gated by an actual assignment relationship (see §3).
- **`DeviceWorkHistory`** is a sub-resource: a timeline of lifecycle events (`PURCHASED`, `INSTALLED`, `REPAIR`, `INSPECTION`, `UNINSTALLED`, `FILTER_CHANGE`) per device. `PURCHASED`/`INSTALLED` are auto-recorded when a device is added; the rest are meant to be recorded elsewhere (e.g. complaint completion) or manually via the work-history endpoints.
- **Complaints optionally reference a device** (`Complaint.deviceId`, nullable) — a complaint does not require one.

---

## 2. Endpoint Reference

All routes mounted at `/api/device` (`src/routes/index.ts`), defined in `src/routes/device.route.ts`. The catalog endpoint is separate: `/api/device-types` (`src/routes/device-types.route.ts`).

| Method + Path | Auth | Controller | Service |
|---|---|---|---|
| `POST /device` | any authenticated user | `DeviceController.addDevice` (`device.controller.ts:14`) | `DeviceService.addDevice` (`device.service.ts:69`) |
| `POST /device/for-customer` | `PROVIDER`/`ADMIN` | `:addForCustomer` (`:124`) | `:addDeviceForCustomer` (`:220`) |
| `GET /device/customer/:userId` | `PROVIDER`/`ADMIN` | `:listForCustomer` (`:106`) | `:getDevicesByUserId` (`:198`) |
| `GET /device` | self | `:getDevices` (`:34`) | `:getDevices` (`:93`) |
| `GET /device/:id` | self (ownership-checked) | `:getDevice` (`:44`) | `:getDevice` (`:109`) |
| `PATCH /device/:id` | self (ownership-checked) | `:updateDevice` (`:53`) | `:updateDevice` (`:126`) |
| `DELETE /device/:id` | self (ownership-checked) | `:deleteDevice` (`:68`) | `:deleteDevice` (`:151`) |
| `POST /device/:id/work-history` | self (ownership-checked) | `:addWorkHistory` (`:77`) | `:addWorkHistory` (`:163`) |
| `GET /device/:id/work-history` | self (ownership-checked) | `:getWorkHistory` (`:97`) | `:getWorkHistory` (`:186`) |
| `DELETE /device/:id/work-history/:entryId` | self (ownership-checked) | `:deleteWorkHistoryEntry` (`:147`) | `:deleteWorkHistoryEntry` (`device.service.ts`, end of file) |
| `GET /device-types` | any authenticated user | `DeviceTypesController.list` | `StrapiService.fetchDeviceTypes` |

Ownership for self-service routes is enforced by a single Prisma pattern repeated everywhere: `findFirst({ id, userId, isDeleted: false })` → 404 *"Device not found"* if it doesn't match. This deliberately doesn't distinguish "doesn't exist" from "exists but isn't yours" — same non-leaking rationale as the auth module's OTP-not-found behavior.

### 2.1 `POST /device`
Body: `{ deviceKey, addressId?, imageUrl?, metadata }`. Controller checks presence of `deviceKey`/`metadata` (400 if missing); the service validates `metadata` against the per-`deviceKey` Zod schema (§4) and validates `deviceKey` itself is a known key (400 *"Unknown device key: X"*). On success, auto-records `INSTALLED` (now) and `PURCHASED` (dated to `metadata.purchaseDate`) work-history entries — this recording is fire-and-forget (wrapped in try/catch, logs on failure, never fails the main request).

### 2.2 `POST /device/for-customer` and `GET /device/customer/:userId`
Provider-facing. **Fixed 2026-09-07**: both now call `assertProviderCanAccessCustomer` (`device.service.ts:52`) before doing anything else — a `PROVIDER` must have at least one non-deleted `Complaint` where `providerId` = them and `userId` = the target customer, or these 403 with *"You are not assigned to this customer"*. `ADMIN` bypasses this check entirely by design. See §3 for why this existed as a gap and exactly what closes it.

### 2.3 `GET /device` / `GET /device/:id`
List/get scoped to `req.user.id`. `GET /device` supports `?deviceKey=` filtering. `GET /device/:id` includes `workHistory` (non-deleted, newest-first) and a trimmed `address` projection.

### 2.4 `PATCH /device/:id`
Body: `{ imageUrl?, metadata? }` — **no `deviceKey` field accepted**, so `deviceKey` is structurally immutable via this route. If `metadata` is provided, it's validated against the **device's own existing `deviceKey`** schema (`device.service.ts:134`), not whatever the caller might wish it were.

### 2.5 `DELETE /device/:id`
Soft-delete only (`isDeleted: true`). A second delete 404s (already gone, by the same ownership-`findFirst` pattern).

### 2.6 Work history sub-resource
Every operation re-checks device ownership independently (no cached/trusted "I already checked this device" shortcut across calls) — consistent, if slightly repetitive. `addWorkHistory` validates `event` against the `WorkHistoryEvent` enum and `eventDate` as a parseable date, both with plain 400s.

### 2.7 `GET /device-types`
Delegates to `StrapiService.fetchDeviceTypes()` — a live GraphQL call to Strapi. **Not wrapped in `ApiError`** — a Strapi/network failure throws a raw `Error('CMS unavailable')` (`strapi.service.ts`), which the central error handler defaults to a 500. This is consistent with how `StrapiService` behaves everywhere else in the codebase (most other call sites just `.catch(() => null)` it at the call site instead), not a device-module-specific inconsistency — noted here so it isn't mistaken for one.

---

## 3. The Provider-Customer Authorization Fix (2026-09-07)

**What was wrong:** `getDevicesByUserId` and `addDeviceForCustomer` took a `targetUserId` and did nothing to confirm the requesting provider had any relationship to that customer. Any authenticated `PROVIDER` (or `ADMIN`) could read or create devices for *any* customer just by knowing/guessing a `userId` — role-gated (`authorize([PROVIDER, ADMIN])`), but not relationship-gated.

**What "assigned" means in this app:** there's no explicit "my customers" list or subscription table to check. The only real signal that a provider has ever legitimately served a customer is a `Complaint` row where `providerId` = that provider and `userId` = that customer. So:

```ts
// device.service.ts:52-67
private static async assertProviderCanAccessCustomer(requesterId, requesterRole, targetUserId) {
  if (requesterRole === Role.ADMIN) return;               // full visibility by design
  const relationship = await prisma.complaint.findFirst({
    where: { providerId: requesterId, userId: targetUserId, isDeleted: false },
  });
  if (!relationship) throw new ApiError(403, 'You are not assigned to this customer');
}
```

Notes for anyone revisiting this:
- A **soft-deleted** complaint does **not** count as an active relationship (tested explicitly — see §6).
- This check does **not** care about complaint *stage* — even a long-closed complaint establishes "has legitimately served this customer at least once." If the business wants a narrower rule (e.g. "only while a complaint is currently open/assigned"), this is the one place to change it.
- If your future self is tempted to relax this because it's inconvenient for some new provider workflow, re-read this section first — it was a real, exploitable gap, not defensive-programming theater.

---

## 4. Metadata Validation (per `deviceKey`)

`src/types/device.types.ts` — one Zod schema per device key in `DEVICE_META_VALIDATORS`: `master_purifier`, `air_conditioner`, `fridge`, `washing_machine`, `geyser`. Each has required `company` + type-specific fields (enums for gas/cooling/load type, numeric ranges like `starRating` 0–5, `.url()` for `starRatingImageUrl`).

**`purchaseDate` (fixed 2026-09-07):** all five schemas share one `purchaseDateSchema` (`device.types.ts:24-32`) instead of a bare `z.string().min(1)`. It accepts `"YYYY-MM-DD"` or `"YYYY-MM"` (radix's month/year picker sends the latter) and **rejects** anything that doesn't parse as a real date. Before this fix, an unparseable string was accepted by validation and silently defaulted to "now" at the point of use (`parsePurchaseDate`, `device.service.ts:29-34`) — a bad client-side date bug would never surface as an error, it would just quietly mis-date the device's `PURCHASED` work-history entry. `parsePurchaseDate`'s own fallback-to-`new Date()` is now effectively unreachable for anything that passes the upstream Zod check, but it's left in place as a defensive default rather than removed.

**Validation error messages (fixed 2026-09-07):** all three metadata-validating call sites (`addDevice`, `updateDevice`, `addDeviceForCustomer`) used to throw a bare `ApiError(400, 'Invalid device metadata', result.error.issues)` — the actual reason was only in `data`, a raw Zod issue array (field paths, error codes) that's developer-shaped, not something you'd show a user. A `describeZodError` helper (`device.service.ts:40-45`) now turns the *first* issue into the primary message, e.g. `"company: Invalid input: expected string, received undefined"` or `"purchaseDate: Purchase date must be a valid date (YYYY-MM-DD or YYYY-MM)"`. The full issue array is still attached as `data` for anything that wants field-level detail — only the primary `message` changed.

---

## 5. Data Model (Prisma)

- **`Device`** (`prisma/schema.prisma`): `id, userId → User, addressId? → Address, deviceKey (string), type (DeviceType enum), imageUrl?, metadata (Json), workHistory[], complaints[], isDeleted, createdAt, updatedAt`. Indexed on `[userId, isDeleted]`, `deviceKey`, `addressId`.
- **`DeviceWorkHistory`**: `id, deviceId → Device, event (WorkHistoryEvent enum), eventDate, notes?, isDeleted, createdAt, updatedAt`.
- **`Complaint.deviceId`** / **`Complaint.deviceKey`**: both nullable — a complaint doesn't require a device, and when present, **this module does not verify** that `deviceId` actually belongs to the complaint's own `userId`. That check (if it should exist) lives in `complaint.service.ts`, outside this module's scope — flagged here so it isn't forgotten when the complaint module gets its own testing pass.

---

## 6. Testing

### 6.1 Infrastructure
Reuses the auth module's test infra (`nexus/docs/authentication.md` §9) — same `nexus_test` local Postgres DB, same Jest/Supertest config, same safety guard against running against a shared/cloud DB. Two additions made for this module:
- `src/tests/dbHelpers.ts` — `resetAuthTables`/`resetDeviceTables` were unified into one `resetAllTestTables()` (both are now aliases for it). **Why:** the two originally cleaned disjoint table sets; once auth and device suites shared one test DB in the same Jest run, a device row left over from one file's tests caused FK violations when a later auth-suite file tried to delete `User` rows out from under a still-referencing `Device`. If you add a new module's tests, extend this one shared reset rather than writing a third disjoint helper.
- `src/tests/authHelpers.ts` — `signAccessToken(user)`, extracted so device tests didn't have to re-duplicate the JWT-signing boilerplate already inline in the auth tests.
- `src/tests/apiClient.ts` — `testRequest()` gained `.patch`/`.delete` (previously only `.get`/`.post`, which is all the auth suite needed).
- `src/tests/device/fixtures.ts` — `createUser(role)`, `createAddressFor(userId)`, `createComplaintLink(userId, providerId, addressId)` (the thing that makes `assertProviderCanAccessCustomer` pass), and `VALID_METADATA` — one valid payload per `deviceKey`, kept in sync with `DEVICE_META_VALIDATORS`' required fields.

### 6.2 Test files (113 tests total across the whole nexus suite as of last run; ~49 are device-specific)

| File | Covers |
|---|---|
| `add-device.test.ts` | Happy path for every `deviceKey` (parameterized) + auto work-history recording, missing/unknown `deviceKey`, missing metadata, per-field metadata validation failures, `starRating` range, malformed `starRatingImageUrl`, the `purchaseDate` fix (several malformed formats + a valid month-precision one), 401 |
| `get-devices.test.ts` | Own-devices-only listing, `deviceKey` filter, single-device fetch with work history, 404 on cross-user access, 404 on nonexistent id, soft-delete exclusion, 401 |
| `update-device.test.ts` | imageUrl-only update, metadata update validated against own schema, rejects wrong-shaped metadata, rejects bad `purchaseDate` on update, 404 cross-user (and confirms the row is untouched), 404 nonexistent |
| `delete-device.test.ts` | Soft-delete semantics, 404 on second delete, 404 cross-user (confirms not actually deleted) |
| `work-history.test.ts` | Add/list/delete entries, missing/invalid `event`, missing/invalid `eventDate`, 404 cross-user on all three operations, 404 for nonexistent entry |
| `provider-customer.test.ts` | The §3 authorization fix: allowed with a real complaint link, 403 with none, `ADMIN` bypass, soft-deleted-complaint-doesn't-count, role gate (`CUSTOMER` blocked before the relationship check even runs), validation on `for-customer` |
| `device-types.test.ts` | Catalog happy path (mocked Strapi), Strapi-failure → 500 *"CMS unavailable"* (not a silently-empty list), 401 |

### 6.3 What's not covered
- No concurrency test for simultaneous work-history writes or simultaneous device creation.
- No test against the real Strapi GraphQL endpoint (mocked throughout, same pattern as the auth module's HanuOTP mocking).
- `Complaint.deviceId` ownership (§5) is untested here because it isn't implemented here.

---

## 7. Known Gaps / Remaining Work

### 7.1 Basic
- [ ] **No rate limiting** on any device endpoint — consistent with the rest of nexus (same gap as auth, see `authentication.md` §8.1), not introduced by this module.
- [ ] **International/non-slug device types** — adding a new device type still means hand-writing a new Zod schema and registering it in `DEVICE_META_VALIDATORS`; there's no generic/dynamic metadata schema, which is fine at 5 types but will get repetitive well before 20.

### 7.2 Advanced
- [ ] **`Complaint.deviceId` isn't verified against `Complaint.userId`.** If a complaint can reference a device belonging to a *different* user than the complaint's own customer, that's a data-integrity hole one level up from this module. Worth a dedicated look whenever the complaint module gets its own audit pass (see `authentication.md`'s style of audit for the template).
- [ ] **`assertProviderCanAccessCustomer`'s "ever served" rule may be too permissive long-term.** It doesn't check complaint stage/recency — a provider who serviced a customer once, years ago, and was later reassigned elsewhere still passes. If the product ever wants "currently assigned" instead of "ever assigned," this is the one function to change (§3).
- [ ] **No audit trail for provider-added devices.** `addDeviceForCustomer` accepts `providerId` into its input but the `Device` row has no column recording which provider added it on the customer's behalf — if support/abuse investigation ever needs "who added this device," that data doesn't exist today.

---

## 8. File Map

```
src/routes/device.route.ts              — route definitions + Swagger JSDoc
src/routes/device-types.route.ts        — GET /device-types (Strapi-backed catalog)
src/controllers/device.controller.ts    — HTTP layer, input presence checks
src/controllers/device-types.controller.ts — thin passthrough to StrapiService
src/services/device.service.ts          — business logic, ownership checks, the provider-customer authorization fix
src/types/device.types.ts               — DEVICE_KEYS, per-type Zod metadata schemas, purchaseDateSchema, request/service input types
prisma/schema.prisma                    — Device / DeviceWorkHistory models
docs/device.md                          — this file
src/tests/device/*.test.ts              — test suites (see §6.2)
src/tests/device/fixtures.ts            — device-specific test fixtures
src/tests/{dbHelpers,authHelpers,apiClient}.ts — shared test infra (extended for this module, see §6.1)
```

---

## 9. Change Log

- **2026-09-07** — Initial hardening pass: fixed the provider-customer authorization gap (`assertProviderCanAccessCustomer`, §3), fixed `purchaseDate` silently accepting unparseable dates (§4), curated validation error messages away from raw Zod issue arrays (§4), added the missing `GET /device-types` test coverage, extended shared test infra to support multi-module test runs, wrote this doc.
