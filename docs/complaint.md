# Complaint Module — Feature Reference

Living reference for the service-request lifecycle — creation, provider matching, on-site QR entry, quoting, payment, and reopening — shared by **serwise** (customer) and **radix** (provider). Read this before touching complaint code; same purpose as `docs/authentication.md` and `docs/device.md`.

Last verified against the codebase: 2026-09-12.

---

## 1. Scope & Design

A **`Complaint`** is a single service ticket. It moves through a fixed 6-stage state machine, optionally references a `Device`, always references an `Address`, and gets assigned to a `Provider` (auto-matched or admin-assigned). Quotes, entry QR tokens, payment, and a reopen chain all hang off this one model.

Two distinct actor surfaces:
- **Customer** (serwise): creates complaints, generates entry QR, responds to quotes, can reopen a closed complaint.
- **Provider** (radix): accepts/rejects assignment, validates entry QR, submits quotes, links a device, completes payment.
- **Admin** (watchtower): full visibility, manual assignment, can act on a customer's behalf (`asAdmin`) for quote response and reopen.

---

## 2. The State Machine

```
ENTRANCE ──► QR_VALIDATED ──► ESTIMATION ──► APPROVAL ──► PAYMENT ──► COMPLETED
    │              │               │             │            │
    └──────────────┴───────────────┴─────────────┴────────────┴──► REJECTED
```

Defined in `STAGE_TRANSITIONS` (`src/services/complaint.service.ts:50-58`), enforced by `updateStage`. **`COMPLETED` and `REJECTED` are terminal** — no transition leaves them (a closed complaint can only move again via `POST /:id/reopen`, which creates a brand-new complaint row, not a stage change on the old one).

Not every stage change goes through `updateStage`/`STAGE_TRANSITIONS` — several endpoints have their own ad hoc stage-mutation logic with their own guards, listed here so nobody assumes the transition table is the single source of truth:

| Stage change | Endpoint | Own guard |
|---|---|---|
| `ENTRANCE → QR_VALIDATED` | `POST /:id/qr/validate` | token match + not expired |
| `QR_VALIDATED → ESTIMATION` | `PATCH /:id/device` | only if currently `QR_VALIDATED` |
| `* → APPROVAL` | `POST /:id/quote` | must be `QR_VALIDATED`/`ESTIMATION` |
| `APPROVAL → PAYMENT` or `COMPLETED` | `PATCH /:id/quote/respond` | must be `APPROVAL`; zero-amount quotes skip straight to `COMPLETED` |
| `APPROVAL → REJECTED` | `PATCH /:id/quote/respond` (declined) | must be `APPROVAL` |
| `PAYMENT → COMPLETED` | `PATCH /:id/complete-payment` | must be `PAYMENT` |

**Fixed 2026-09-12**: the Swagger doc on `PATCH /:id/stage` used to claim `APPROVAL → ESTIMATION` was valid — it never was in `STAGE_TRANSITIONS`. Docs corrected to match the code, not the other way around.

---

## 3. Endpoint Reference

Mounted at `/api/complaint` (singular — not `/complaints`). All in `src/routes/complaint.route.ts`.

| Method + Path | Auth | Controller |
|---|---|---|
| `POST /` | `auth`, `[CUSTOMER, ADMIN]` | `createComplaint` |
| `GET /` | `auth`, `[ADMIN]` | `listComplaints` |
| `GET /my` | `auth`, `[CUSTOMER]` | `myComplaints` |
| `GET /assigned` | `auth`, `[PROVIDER]` | `assignedComplaints` |
| `GET /:id` | `auth` only — ownership checked in-service | `getComplaint` |
| `DELETE /:id` | `auth` only — ownership checked in-service | `deleteComplaint` |
| `PATCH /:id/stage` | `auth`, `[PROVIDER, ADMIN]` | `updateStage` |
| `PATCH /:id/assign` | `auth`, `[ADMIN]` | `assignProvider` |
| `PATCH /:id/accept` | `auth`, `[PROVIDER]` | `acceptAssignment` |
| `PATCH /:id/reject-assignment` | `auth`, `[PROVIDER]` | `rejectAssignment` |
| `POST /:id/quote` | `auth`, `[PROVIDER]` | `addQuote` |
| `PATCH /:id/quote/respond` | `auth`, `[CUSTOMER, ADMIN]` | `respondToQuote` |
| `PATCH /:id/device` | `auth`, `[CUSTOMER, PROVIDER, ADMIN]` | `linkDevice` |
| `PATCH /:id/complete-payment` | `auth`, `[PROVIDER]` | `completePayment` |
| `POST /:id/qr/generate` | `auth`, `[CUSTOMER]` | `generateEntryQr` |
| `POST /:id/qr/validate` | `auth`, `[PROVIDER]` | `validateEntryQr` |
| `POST /:id/qr/request-scan` | `auth`, `[PROVIDER]` | `requestEntranceScan` |
| `POST /:id/reopen` | `auth`, `[CUSTOMER, ADMIN]` | `reopenComplaint` |
| `PATCH /:id/dev/advance` | `auth` only, **route registered only when `NODE_ENV !== 'production'`** | `devAdvanceStage` |

### 3.1 Ownership pattern — now consistent (fixed 2026-09-12)
Every provider-scoped service method filters its `findFirst` by `providerId`, returning **404** `"Complaint not found or not assigned to you"` for both "doesn't exist" and "not yours" (non-leaking). `getById`, `deleteComplaint`, and `linkDevice` used to return **403** `"Forbidden"` for the ownership case instead — standardized to 404 across the board so no endpoint tells an unrelated caller "this exists but isn't yours." `authorize([...])` role gates (wrong role entirely) still correctly 403 — that's a different, legitimate signal from `authorize.middleware.ts`, not a leak.

### 3.2 The one real authorization bug found here (fixed 2026-09-12)
`updateStage` had **no ownership check at all** before this fix — every other provider-facing method filters by `providerId` in its `findFirst`, but this one only checked `{ id: complaintId, isDeleted: false }`. Any authenticated `PROVIDER` (not just the assigned one) could transition *any* complaint's stage, including forcing someone else's job to `REJECTED`. Fixed by adding the same `providerId`-scoping pattern, gated on `requesterRole === Role.PROVIDER` (ADMIN stays unrestricted by design). If you ever add a new stage-mutating endpoint, copy this pattern, not the old code.

---

## 4. Creation (`createComplaint`, `service.ts:128-199`)

- Validates `addressId` belongs to the caller (404 if not).
- `deviceId` (single) or `deviceIds` (batch) — each validated to belong to the caller (404 if not); device pre-must exist, none is auto-created.
- **Fixed 2026-09-12 — multi-device creation is now atomic.** Previously validation and creation were interleaved in one loop: device 2 of 3 failing ownership left device 1's complaint already committed. Now every device in the batch is validated up front, then all complaints are created in a single `prisma.$transaction([...])` — either the whole batch exists or none of it does. Side effects (realtime, notification, auto-assign, Telegram) only fire after the transaction commits.
- ADMIN must pass `customerId` (raising a ticket on a customer's behalf) — 400 if omitted.

---

## 5. Provider Assignment & Auto-Matching

`autoAssignProvider` (`service.ts:201-260`): filters active `PROVIDER` users, excludes `excludeIds`, matches `providerProfile.skills` against the complaint's device type **only if the complaint has a linked device** (unknown device type → matches any active provider), picks whoever has the fewest currently-open complaints. Zero matches → complaint stays unassigned, Telegram-alerts admins (`TelegramService.notifyNoProviderMatch`) — no retry loop of its own.

**Two places call this and are meant to keep a complaint moving toward a provider — both had the same bug, both fixed 2026-09-12:**
- `rejectAssignment` (`service.ts:466-503`) — clears `providerId`, pushes to `rejectedProviderIds`, sends a notification promising *"we are finding another [provider]."* Previously never actually called `autoAssignProvider` — the complaint just silently stalled unassigned until an admin manually reassigned it. Now re-runs `autoAssignProvider(complaintId, updated.rejectedProviderIds)` right after.
- `reopenComplaint` (`service.ts:809-863`) — creates a fresh complaint via a raw `prisma.complaint.create`, **not** the `createComplaint()` path, so it never went through the auto-assign side effect either, despite its own notification promising *"we are finding a provider."* Same fix, same reasoning.

If you add a third path that creates or re-queues a complaint, check whether it needs the same `emit(() => ComplaintService.autoAssignProvider(...))` call — this bug shape has now appeared twice.

`assignProvider` (admin, manual) blocks assigning to a `COMPLETED`/`REJECTED` complaint (400) and resets `providerAccepted`. `acceptAssignment` 400s on double-accept. Both are `providerId`-scoped, 404 for a non-assigned provider.

---

## 6. Quote Flow

`Quote` is 1:1 with `Complaint` (unique `complaintId`). `addQuote` (assigned provider only, must be `QR_VALIDATED`/`ESTIMATION`) upserts the quote, computes `totalAmount` from line items, force-advances the complaint to `APPROVAL`.

`respondToQuote` (customer, or admin via `asAdmin`):
- **Approve, non-zero total** → `PAYMENT`.
- **Approve, zero total** → straight to `COMPLETED`, skipping the payment step entirely (free jobs never touch wallet logic), and records a device work-history entry.
- **Reject** → `REJECTED`, quote marked `REJECTED`, `rejectionReason`/`rejectedAt`/`rejectedBy` recorded.

---

## 7. Payment (`completePayment`, `service.ts:969-1044`)

Provider-only, must be in `PAYMENT` stage. `method` is `CASH` or `WALLET` (`CompletePaymentSchema`).

**Fixed 2026-09-12 — WALLET completions now actually verify and move money.** Before this fix, `method: 'WALLET'` completed the job and credited the provider's earnings with **zero verification** the customer had any funds, or any debit at all — a provider could mark any job "paid by wallet" for free. Now:

- `WalletService.debitCustomerForComplaintPayment(userId, amount, complaintId, tx)` (`wallet.service.ts`, added 2026-09-12) — checks the customer's wallet exists, is active, and `balance >= amount`; throws `ApiError(400, ...)` otherwise (`"Customer wallet not found"` / `"Insufficient wallet balance to complete this payment"`).
- This debit runs **inside the same transaction** as the complaint's stage update and the provider's credit (`WalletService.creditProviderEarnings`), now at **`Serializable`** isolation — a failed/insufficient debit rolls back everything: complaint stays in `PAYMENT`, provider isn't credited, customer isn't charged. No path exists where one side moves without the other.
- `CASH` is unchanged — no wallet interaction at all, treated as an on-site attestation by the provider.

This module has **no gateway-verified online payment path** for job completion — `CASH`/`WALLET` are the only two methods, and neither talks to Razorpay. (A *separate*, unrelated Razorpay flow exists in `payment.service.ts` for `purpose: 'complaint_payment'` — that's for creating a complaint *after* an externally-verified Razorpay payment, a different product flow entirely, not something `completePayment` reuses.)

---

## 8. Entry QR (10-minute physical entry token)

`generateEntryQr` (customer, `ENTRANCE`/`QR_VALIDATED` only) — `randomUUID()` token, 10-min expiry (`QR_EXPIRY_MINUTES`, `service.ts:95`). `validateEntryQr` (assigned provider, `ENTRANCE` only) — exact token match + not expired, success clears the token and advances to `QR_VALIDATED`. `requestEntranceScan` (assigned provider) — regenerates the token if missing/expired, notifies the customer to show it; a no-op nudge otherwise.

Expired/wrong-token failures are both plain 400s with distinct messages (`"Invalid QR token"` vs `"...has expired. Ask the customer to regenerate."`) — no auto-refresh on validate, the customer or provider must explicitly request a new one.

---

## 9. Reopen

`POST /:id/reopen` (customer or admin via `asAdmin`), only from `COMPLETED`/`REJECTED`. Creates a **new** `Complaint` row with `parentId` pointing at the original, fresh `stage: ENTRANCE`, copies device/deviceKey, defaults title/notes/address from the original unless overridden. **No cap on chain depth** — a complaint can be reopened indefinitely (not fixed; a judgment call left open, see §11).

---

## 10. Error Handling & Message Catalog

Fully `ApiError`/`ApiResponse` — no raw `Error` throws anywhere in this module (unlike auth's original state). All 9 Zod-validated endpoints go through `describeZodError` (`src/utils/zodError.ts`, shared with the device module) — **fixed 2026-09-12**: this used to return a generic `"Validation failed"` with the raw Zod issue array as `data`; now it surfaces the first failing field and a human reason as the primary `message`, e.g. `"stage: Please select a valid stage"`.

Several schema fields had **no custom message at all** before this pass and would have shown raw Zod internals (`"Invalid option: expected one of \"CASH\"|\"WALLET\""`) even after the `describeZodError` fix — these got real messages added directly in `complaint.types.ts`:

| Field | Schema | Message |
|---|---|---|
| `stage` | `UpdateStageSchema` | "Please select a valid stage" |
| `method` | `CompletePaymentSchema` | "Please choose a payment method: CASH or WALLET" |
| `approved` | `RespondToQuoteSchema` | "Please specify whether the quote is approved" |
| `title` (max length) | `CreateComplaintSchema`, `ReopenComplaintSchema` | "Title must be 200 characters or fewer" |
| `deviceIds` (empty array) | `CreateComplaintSchema` | "At least one device is required" |
| `addressId` | `ReopenComplaintSchema` | "Invalid address ID" (previously no message on this one specifically) |
| `items[].name/unitPrice/quantity` | `AddQuoteSchema` | "Item name is required" / "Unit price cannot be negative" / "Quantity must be at least 1" |

**If you add a new Zod field to any schema in `complaint.types.ts`, give it a real message** (`.min()`, `.max()`, `.uuid()`, `z.enum([...], 'message')`, `z.boolean({ error: 'message' })`, `z.nativeEnum(Enum, { error: 'message' })`) — the pattern of "it'll get caught by describeZodError anyway" only produces a *specific* message, not a *friendly* one, if the schema itself never had one to surface.

---

## 11. Known Gaps / Remaining Work

### 11.1 Basic
- [ ] **No cap on reopen chain depth.** A complaint can be reopened indefinitely (COMPLETED → new ENTRANCE → ... → COMPLETED → reopen → ...). Explicitly left as a judgment call, not fixed — decide if a business rule (e.g. max N reopens, or block reopening a complaint that already has an open child) is wanted.
- [ ] **No rate limiting** on any endpoint — same known gap as every other module.

### 11.2 Advanced
- [ ] **`Complaint.deviceId` is never verified against `Complaint.userId`.** Flagged from the device module review and still true here — if a complaint's `deviceId` could ever point at a device belonging to someone other than `Complaint.userId`, nothing in this module catches it. `linkDevice` correctly re-validates ownership against the complaint's customer; `createComplaint` correctly validates against the creator; but there's no invariant check elsewhere (e.g. a data-integrity job) that would catch a device getting reassigned to a different owner after being linked.
- [ ] **No session/idempotency key on mutation endpoints** — a double-tap on `complete-payment` or `accept` relies entirely on the stage guard (e.g. "must be in PAYMENT") to reject the second call, not an explicit idempotency mechanism. Works today because stage transitions are one-directional, but worth knowing if any endpoint's guard is ever loosened.
- [ ] **`autoAssignProvider`'s matching is "fewest active complaints," nothing more** — no geography, no rating, no provider tier weighting. Fine for current scale; revisit if provider-side complaints about assignment fairness ever come up.

---

## 12. Testing

### 12.1 Infrastructure
Same `nexus_test` local Postgres DB and Jest/Supertest harness as auth and device (see `authentication.md` §9). `resetAllTestTables()` (`src/tests/dbHelpers.ts`) was extended to also clean `Quote` and `ProviderProfile` (in FK-safe order) since complaint tests touch both; aliased as `resetComplaintTables` for readability at call sites.

`src/tests/complaint/fixtures.ts` — re-exports `createUser`/`createAddressFor`/`VALID_METADATA` from the device module's fixtures (no duplication), adds `createDeviceFor`, `createProviderWithSkills` (creates a `ProviderProfile` with given `DeviceType[]` skills — needed for `autoAssignProvider` matching tests), and `createComplaintFor` (direct Prisma insert with stage/provider/quote overrides, bypassing the API for fast test setup).

Realtime/Notification/Telegram services are mocked in every complaint test file (same convention as auth/device) — real pushes, DB notification rows, and Telegram calls never happen in tests.

### 12.2 Test files (192 tests total across the whole nexus suite as of last run; complaint-specific tests are in these 7 files)

| File | Covers |
|---|---|
| `create-complaint.test.ts` | Happy path (with/without device), address/device ownership 404s, validation, ADMIN `customerId` requirement, the multi-device atomic-transaction fix, role gate |
| `stage-transitions.test.ts` | Legal/illegal transitions, the `APPROVAL→ESTIMATION` non-transition, the `updateStage` ownership fix, ADMIN bypass, `REJECTED` metadata recording, role gate, the curated `stage` message |
| `provider-assignment.test.ts` | `assign`/`accept`/`reject-assignment`, the reassign-after-reject fix (verified via a short wait on the fire-and-forget task), the "no eligible provider left" case |
| `quote-and-payment.test.ts` | Quote submission + stage-guard, approve/reject responses (incl. zero-amount skip-to-COMPLETED), the WALLET balance-verification fix (sufficient/insufficient/no-wallet), CASH baseline, the curated `approved`/`method` messages |
| `entry-qr.test.ts` | Generate/validate/request-scan, expiry, wrong token, stage guards, ownership |
| `device-link-reopen.test.ts` | `linkDevice` ownership (provider/customer/admin paths), the reopen-triggers-auto-assign fix, reopen stage guard |
| `read-delete.test.ts` | `getById`/`myComplaints`/`assignedComplaints`/admin `listComplaints`/`deleteComplaint`, the 403→404 standardization |

### 12.3 What's not covered
- No load/concurrency test for two simultaneous `complete-payment` calls on the same complaint (the `Serializable` isolation should prevent a double-charge, but this isn't explicitly tested).
- No test for the reopen-chain-depth non-limit (there's nothing to test — it's simply unbounded).
- No test against a real Strapi/Razorpay/Telegram integration — all mocked, consistent with every other module.

---

## 13. File Map

```
src/routes/complaint.route.ts           — route definitions + Swagger JSDoc (stage-transition doc fixed 2026-09-12)
src/controllers/complaint.controller.ts — HTTP layer, Zod validation via describeZodError
src/services/complaint.service.ts       — all business logic: state machine, assignment, quotes, payment, QR, reopen
src/services/wallet.service.ts          — debitCustomerForComplaintPayment (added 2026-09-12), creditProviderEarnings
src/types/complaint.types.ts            — Zod schemas (all fields now have user-facing messages) + input/body types
src/utils/zodError.ts                   — describeZodError, shared with device.service.ts
prisma/schema.prisma                    — Complaint / Quote models
docs/complaint.md                       — this file
src/tests/complaint/*.test.ts           — test suites (see §12.2)
src/tests/complaint/fixtures.ts         — complaint-specific test fixtures
src/tests/dbHelpers.ts                  — resetAllTestTables, extended for Quote/ProviderProfile
```

---

## 14. Change Log

- **2026-09-12** — Initial hardening pass: fixed the multi-device partial-creation bug (now atomic), added real WALLET balance verification to `completePayment` (previously zero verification existed), fixed two instances of "notification promises auto-reassignment but never triggers it" (`rejectAssignment`, `reopenComplaint`), fixed a genuine authorization hole in `updateStage` (no ownership check at all), standardized 403→404 for all "not your complaint" cases, corrected the `APPROVAL→ESTIMATION` Swagger doc mismatch, extracted and applied `describeZodError` to all 9 validated endpoints, and added real user-facing messages to every previously-unmessaged Zod field. Wrote 76 tests (192 total across the suite), wrote this doc.
