# Authentication Module — Feature Reference

Living reference for the phone/OTP authentication system shared by **serwise** (consumer app) and **radix** (provider app), both backed by this **nexus** service. Read this before touching any auth code — it's meant to hold everything so nothing gets missed or silently re-broken across sessions.

Last verified against the codebase: 2026-09-07.

---

## 1. Scope & Design

- **Auth method:** phone number + OTP only. No passwords, no email/password login, no social OAuth.
- **Two flows on the same backend, different rules:**
  - **Consumer (serwise):** `/api/auth/*` — auto-creates a `User` + `Wallet` on first successful OTP verify.
  - **Provider (radix):** `/api/auth/provider/*` — **never** creates an account. A phone must already exist as an active, non-deleted `PROVIDER`-role user (provisioned elsewhere, e.g. admin/onboarding) or every call 403s.
- **Tokens:** JWT access token + JWT refresh token. Refresh tokens are also persisted in Postgres (`RefreshToken` table) so they can be revoked (logout deletes the row).
- **Email** is a separate, later step (`UserController.updateEmail`, `src/controllers/user.controller.ts`) — not part of this module, no email verification exists.
- **Supabase** is used elsewhere in nexus (Realtime, Storage) but **not** for auth — don't confuse the two when reading configs.

---

## 2. Endpoint Reference

All routes mounted at `/api/auth` (see `src/routes/index.ts:25` → `router.use('/auth', authRoutes)`), defined in `src/routes/auth.route.ts`. Every request to any nexus route (not just auth) also requires an `x-app-id` header (`src/middlewares/context.middleware.ts`) — unrelated to auth, but requests without it 400 before ever reaching these controllers.

| Method + Path | Controller | Service | Auth required? |
|---|---|---|---|
| `POST /api/auth/request-otp` | `AuthController.requestOtp` (`src/controllers/auth.controller.ts:8`) | `AuthService.generateOtp` (`src/services/auth.service.ts:25`) | No |
| `POST /api/auth/verify-otp` | `AuthController.verifyOtp` (`:25`) | `AuthService.verifyOtp` (`:69`) | No |
| `POST /api/auth/refresh-token` | `AuthController.refreshToken` (`:45`) | `AuthService.refreshAccessToken` (`:185`) | No (refresh token is the credential) |
| `POST /api/auth/logout` | `AuthController.logout` (`:59`) | `AuthService.logout` (`:212`) | No (refresh token is the credential) |
| `POST /api/auth/provider/request-otp` | `AuthController.providerRequestOtp` (`:73`) | `AuthService.providerRequestOtp` (`:233`) | No |
| `POST /api/auth/provider/verify-otp` | `AuthController.providerVerifyOtp` (`:90`) | `AuthService.providerVerifyOtp` (`:247`) | No |

### 2.1 `POST /request-otp`
Body: `{ phoneNo }`. Validates presence (400 *"Phone number is required"*) then format (400 *"Please enter a valid 10-digit phone number"*, `src/utils/validators.ts`). Calls `generateOtp` → 200 *"OTP sent successfully"*, or 502 *"Failed to send OTP. Please try again."* if the SMS provider fails.

### 2.2 `POST /verify-otp`
Body: `{ phoneNo, otp, role? }` (`role` defaults to `CUSTOMER`, only relevant on first-ever signup for that phone). Validates presence, then phone format, then OTP format (each a distinct 400). On success: creates the user + wallet if new, credits a welcome bonus if enabled in the CMS, issues tokens, and — only for **existing** users — fires a "New Sign-In Detected" push. Returns `{ user, tokens, isNewUser }`.

### 2.3 `POST /refresh-token`
Body: `{ refreshToken }`. Verifies the JWT signature/expiry, then checks the DB row still exists and hasn't separately expired (belt-and-suspenders — DB expiry currently always matches the JWT's own expiry, see §7.2). Returns a new `{ accessToken }` only — the refresh token itself is **not** rotated (see §8, "Basic" list).

### 2.4 `POST /logout`
Body: `{ refreshToken }` (optional). Deletes the matching `RefreshToken` row if present. **Always** returns 200, even with a missing/invalid/already-deleted token — this is intentional idempotency, not a bug.

### 2.5 `POST /provider/request-otp` / `POST /provider/verify-otp`
Same shape as consumer, but every call first requires an existing `User` with `role === PROVIDER`, `isActive: true`, `isDeleted: false` — otherwise 403 *"This number is not registered as a professional"* (request-otp) or *"Provider account not found"* (verify-otp, checked again after OTP success in case status changed mid-flow). Never creates a user, never sets `isNewUser`.

---

## 3. OTP Mechanics

Defined in `src/services/auth.service.ts`.

- 6-digit numeric code (`Math.floor(100000 + Math.random() * 900000)`, line 26).
- Hashed with bcrypt before storage (`otp.upsert`, lines 30–46) — never stored in plaintext.
- **One active OTP per phone number** — `Otp` table is keyed by `phoneNo` (unique), so a new request always overwrites the old one and resets `attempts` to 0. There is no way to have two outstanding OTPs for the same number.
- TTL: 10 minutes (`OTP_TTL_MINUTES`, line 15). Checked on verify (line 76); an expired row is deleted on the spot.
- Max attempts: 5 (`OTP_MAX_ATTEMPTS`, line 16). Once hit, **every** subsequent verify — even with the correct code — 429s until a fresh OTP is requested (which resets the counter).
- **Test phones** (`TEST_PHONES`, lines 18–22): `1234567890`, `9112345678`, `7016301968`, all matched by the fixed code `123456`. These bypass the real SMS send and the bcrypt comparison (literal string match instead), but **do not** bypass the "an OTP record must exist" check — you still have to call `request-otp` first. **Deliberately active in every environment including production** so the team can test post-launch without burning HanuOTP's rate limits — do not add environment gating to this without checking with the team first (this was an explicit decision, not an oversight).
- Delivery via HanuOTP (`src/services/hanuotp.service.ts`), a simple GET-based SMS API. A non-success response throws `ApiError(502, ...)` and surfaces to the client — no silent retry.

---

## 4. Token Mechanics

- **Access token:** JWT payload `{ id, phoneNo, role }`, expiry from `config.jwt.accessExpiry` (env `JWT_ACCESS_EXPIRY`, currently `30d` in `.env.local`/`.env.test`).
- **Refresh token:** JWT payload `{ id }` only, expiry from `config.jwt.refreshExpiry` (`JWT_REFRESH_EXPIRY`, currently `60d`). Also written to the `RefreshToken` table (`token`, `userId`, `expiresAt`) so it can be revoked server-side.
- Both signed with the same `JWT_SECRET` (`config.jwt.secret`) — see `AuthService.generateAuthTokens`, `src/services/auth.service.ts:155`.
- **Refresh token DB expiry parsing is fragile:** `parseInt(config.jwt.refreshExpiry)` (line 171) only works correctly for a plain "Nd" (days) string. If `JWT_REFRESH_EXPIRY` were ever set to something like `"12h"`, `parseInt` would silently read `12` and treat it as **12 days**, not 12 hours — the DB expiry and the JWT's own `exp` claim would then disagree. Not currently a live bug (both env files use day-strings), but a landmine if that env var is ever changed. See §8.
- **Rolling access-token refresh** (`src/middlewares/auth.middleware.ts:28-51`): on every authenticated request, if less than 50% of the access token's lifespan remains, a fresh one is silently issued and sent back in the `x-new-access-token` response header (with `Access-Control-Expose-Headers` set so browser clients can read it). The refresh token itself is untouched by this.
- **No refresh-token rotation:** calling `/refresh-token` does not invalidate the old refresh token or issue a new one — the same refresh token can be used repeatedly until it naturally expires or `/logout` deletes it. See §8.

---

## 5. Middleware

### 5.1 `authenticate` (`auth` export) — `src/middlewares/auth.middleware.ts`
- No `Authorization` header, or a header with no space (so `.split(" ")[1]` is `undefined`) → 401 **"Please log in to continue"** (line 21).
- Header present but `jwt.verify` throws (malformed, wrong secret, expired) → 401 **"Your session has expired. Please log in again"** (line 55).
- Valid token → decoded payload attached to `req.user`, rolling-refresh check runs, `next()`.
- **Known gap:** does **not** re-check the database. A user that's been soft-deleted or deactivated *after* their token was issued still passes this middleware until the token's natural expiry (up to 30 days for access tokens, since there's no per-request DB check). See §8.

### 5.2 `authorize(roles: Role[])` — `src/middlewares/authorize.middleware.ts`
- No `req.user` (i.e. `authenticate` wasn't run first, or somehow didn't attach a user) → 401 **"Please log in to continue"**.
- `req.user.role` not in the allowed list → 403 **"You don't have permission to perform this action"**.
- Usage pattern: `router.get('/', authenticate, authorize([Role.ADMIN]), Controller.method)`.

---

## 6. Error Handling Conventions

Central handler: `src/middlewares/errorHandler.ts`. Any `ApiError(statusCode, message)` thrown in a service is caught here and turned into `ApiResponse.error(res, statusCode, message)`. Anything that isn't an `ApiError` (a raw `Error`, a thrown string, etc.) defaults to **500** — this is why every auth failure path must throw `ApiError`, never a plain `Error` (this was previously a bug — see git history, fixed 2026-09-07).

**Response shape** (`src/utils/apiResponse.ts`): every response, success or error, is
```json
{ "statusCode": number, "success": boolean, "message": string, "data": any | null }
```
`success` is `statusCode < 400`. The frontend apps (serwise, radix) branch **only on `statusCode`**, never on `message` text — confirmed by direct code search — so `message` is free to be reworded for tone without breaking client logic. It exists purely for display.

### 6.1 Current message catalog (all user-facing, all confirmed non-brittle to reword)

| Status | Message | Where |
|---|---|---|
| 400 | "Phone number is required" | `auth.controller.ts` (missing phoneNo, all 4 relevant endpoints) |
| 400 | "Phone number and OTP are required" | `auth.controller.ts` (verify-otp, provider/verify-otp) |
| 400 | "Please enter a valid 10-digit phone number" | `auth.controller.ts` + `utils/validators.ts` |
| 400 | "Please enter a valid 6-digit OTP" | `auth.controller.ts` + `utils/validators.ts` |
| 400 | "OTP not found or expired" | `auth.service.ts` (no OTP record for phone) |
| 400 | "OTP expired" | `auth.service.ts` (record exists but past `expiresAt`) |
| 400 | "Invalid OTP" | `auth.service.ts` (wrong code, increments `attempts`) |
| 429 | "Maximum OTP attempts exceeded" | `auth.service.ts` (5 failed attempts) |
| 502 | "Failed to send OTP. Please try again." | `auth.service.ts` (HanuOTP send failed) |
| 400 | "Refresh token is required" | `auth.controller.ts` |
| 401 | "Your session has expired. Please log in again" | `auth.service.ts` (bad/expired refresh token), `auth.middleware.ts` (bad/expired access token) |
| 401 | "Please log in to continue" | `auth.middleware.ts` / `authorize.middleware.ts` (no token / no `req.user`) |
| 403 | "You don't have permission to perform this action" | `authorize.middleware.ts` (wrong role) |
| 403 | "This number is not registered as a professional" | `auth.service.ts` (provider request-otp gate) |
| 403 | "Provider account not found" | `auth.service.ts` (provider verify-otp gate) |
| 200 | "OTP sent successfully" / "Login successful" / "Token refreshed successfully" / "Logged out successfully" | success paths |

If you add a new failure path, **match this tone**: plain, short, tells the user what to do next, never exposes internal concepts (JWT, refresh token, database, provider names) unless unavoidable.

---

## 7. Data Model (Prisma)

Relevant models in `prisma/schema.prisma`:

- **`User`** (`~line 139`): `id, phoneNo (unique), email?, role, isActive, isDeleted, referralCode?, wallet?, refreshTokens[]`. `role` is `CUSTOMER | PROVIDER | ADMIN` (see `Role` enum).
- **`Otp`** (`~line 276`): `id, phoneNo (unique), otp (hashed), expiresAt, attempts`. One row per phone, always overwritten.
- **`RefreshToken`** (`~line 265`): `id, token (unique), userId, expiresAt`. One row per issued refresh token; deleted on logout or on refresh-time expiry detection.
- **`Wallet`**: created alongside a new `User` on first consumer signup (`WalletType.CUSTOMER` or `.PROVIDER` based on role).

---

## 8. What's Deliberately NOT Done Yet (read before extending this feature)

Split by effort/impact so you can pick these up without re-discovering them. Each entry has **why it matters** and **what to check first** if you pick it up.

### 8.1 Basic — small, should probably do before/soon after wider prod traffic

- [ ] **OTP resend cooldown / rate limiting** on `request-otp`, per phone number and ideally per IP. Currently completely unthrottled for real (non-test) numbers — someone could spam a real user's phone with SMS, or exhaust HanuOTP quota/cost.
  *Why:* SMS pumping fraud is a known abuse pattern against exactly this kind of unthrottled endpoint. *Check first:* whether `express-rate-limit` (not currently a dependency) or a simple Redis/DB-backed cooldown fits the deployment better.
- [ ] **Re-check user status in `authenticate` middleware.** Right now a soft-deleted or deactivated user's token keeps working until natural expiry (up to 30 days). *Why:* if support/admin deactivates an abusive or fraudulent account, they'd reasonably expect it locked out immediately, not in up to a month. *Check first:* the perf cost of a DB read on every authenticated request — may want a short-TTL cache instead of a query per request.
- [ ] **Fix the refresh-expiry parsing landmine** (`auth.service.ts:171`, `parseInt(config.jwt.refreshExpiry)`). Swap for a real duration parser (e.g. the `ms` package) so the DB `expiresAt` always matches the JWT's own `exp`, regardless of what unit `JWT_REFRESH_EXPIRY` is set to.
- [ ] **International / non-Indian phone number support.** `utils/validators.ts` hardcodes exactly 10 digits, no country code. Fine for India-only launch; will need rework (E.164 format, country code storage) before any international expansion.
- [ ] **Logout-all-devices.** Currently `/logout` only deletes the one refresh token passed in. There's no "sign out everywhere" for a user who suspects their account is compromised.
- [ ] Add a **concurrency test** for two near-simultaneous `verify-otp` calls on the same phone (double-tap protection) — not currently tested, unclear if the attempt-increment logic has a race window under load.

### 8.2 Advanced — bigger effort, do deliberately, not accidentally

- [ ] **Refresh token rotation + reuse detection.** Best practice: every `/refresh-token` call should issue a *new* refresh token and invalidate the old one; if an already-used (rotated-away) refresh token is presented again, that's a strong signal of theft — invalidate *all* sessions for that user. Currently refresh tokens are reusable indefinitely until expiry or explicit logout.
- [ ] **Hash refresh tokens at rest.** They're currently stored as plaintext JWTs in the `RefreshToken.token` column (same pattern OTPs deliberately avoid via bcrypt). A DB leak would hand out directly-usable session tokens. Store a hash, compare on lookup, same as the OTP pattern already used elsewhere in this file.
- [ ] **Session/device management UI.** No way for a user (or admin) to see "you're logged in on these N devices" or revoke one specific session — only all-or-nothing via the single refresh token passed to `/logout`.
- [ ] **CAPTCHA / bot protection** on `request-otp` before it's exposed to real-world abuse volume — pairs with the rate-limiting item above but is a separate layer (rate limiting slows a single actor; CAPTCHA stops scripted abuse across many numbers/IPs).
- [ ] **Audit/security event log**, separate from the ad-hoc push notifications currently sent on sign-in/sign-out (`NotificationService.sendToUser` calls in `auth.service.ts`). A structured table (`event`, `userId`, `ip`, `userAgent`, `timestamp`) would support support/compliance review and abuse investigation far better than notification records.
- [ ] **Anomaly/geo-velocity detection** on sign-in (e.g. same account signing in from two countries within minutes) — would build on top of the audit log above.
- [ ] **MFA / backup codes** as an optional second factor for `PROVIDER` or `ADMIN` roles, given they can access higher-value operations than a `CUSTOMER`.
- [ ] **Contract test against the real HanuOTP sandbox** (currently the provider is fully mocked in all tests) run occasionally/manually, to catch upstream API changes that unit tests with mocks can never surface.
- [ ] **Load testing** `request-otp` and `verify-otp` under realistic concurrent traffic — no load/perf testing has been done at all.
- [ ] **Alerting** on abnormal spikes in failed-OTP rate (possible brute force) or HanuOTP failure rate (possible provider outage) — currently only `logger.error` calls, no monitoring hook.

---

## 9. Testing

### 9.1 Infrastructure
- **Dedicated test database:** local Postgres `nexus_test` (never the shared `nexus` dev DB, never any cloud DB). `src/tests/globalSetup.ts` hard-refuses to run if `DATABASE_URL` doesn't contain `nexus_test` — this guard is intentional, do not remove it or point it at a shared DB.
- **Config:** `jest.config.js` (ts-jest + Supertest, `maxWorkers: 1` — required because all suites share one DB and reset tables in `beforeEach`; running in parallel workers causes cross-suite races).
- **Env:** `.env.test` — placeholder values for Cloudinary/Supabase/OTA keys (required by the config schema but never exercised by auth tests), real-shaped values for `DATABASE_URL`/`JWT_SECRET`.
- **App under test:** `src/tests/testApp.ts` calls `initializeConfig()` then `require()`s the Express app (not `import()` — ts-jest's CommonJS transpile doesn't support dynamic `import()`).
- **DB reset:** `src/tests/dbHelpers.ts::resetAuthTables()` — deletes in FK order: `WalletLedger → RefreshToken/Wallet → User`, plus `Otp`. Called in every suite's `beforeEach`.
- **Every request needs `x-app-id`:** `src/tests/apiClient.ts::testRequest(app)` wraps Supertest to always set `x-app-id: serwise-app` — unrelated to auth, but required by `contextMiddleware` on every route.
- **External services are mocked**, never hit for real: `hanuotp.service.ts` (`sendOtpSms`), `strapi.service.ts` (`fetchWelcomeBonus`), `telegram.service.ts` (`notifyNewUser`), `notification.service.ts` (`sendToUser`).
- **Run it:** `yarn test` from `nexus/`. Setup, from scratch, if `nexus_test` doesn't exist yet:
  ```bash
  psql -h localhost -U postgres -p 5432 -c "CREATE DATABASE nexus_test;"
  DATABASE_URL="postgresql://postgres:root@localhost:5432/nexus_test?schema=public" \
  DIRECT_URL="postgresql://postgres:root@localhost:5432/nexus_test?schema=public" \
  npx prisma db push --skip-generate
  yarn test
  ```
- **Build hygiene:** `.test.ts` files and `src/tests/**` are excluded from the production `tsconfig.json` (`exclude` array) — they must never leak into `dist/` or break `yarn build`/`tsc --noEmit`.

### 9.2 Test files (55 tests total as of last run)

| File | Covers |
|---|---|
| `src/tests/auth/request-otp.test.ts` | Happy path, missing/malformed phone, test-phone SMS bypass, OTP overwrite on repeat request, HanuOTP failure → 502 |
| `src/tests/auth/verify-otp.test.ts` | Missing/malformed phone+OTP, OTP not-found/expired/wrong/max-attempts, new-user creation + wallet + welcome bonus, existing-user login + "new sign-in" push (and that it's *not* sent for brand-new accounts), test-phone login, response-shape consistency |
| `src/tests/auth/refresh-token.test.ts` | Happy path, missing token, malformed JWT, expired JWT, JWT valid but no DB row, DB-expired token (+ stale row cleanup), token signed with wrong secret |
| `src/tests/auth/logout.test.ts` | Deletes the token, idempotent on missing/nonexistent token |
| `src/tests/auth/provider-auth.test.ts` | Both provider endpoints: active provider happy path, unregistered/customer-role/inactive/deleted-account 403s, malformed phone/OTP, all the same OTP business-rule cases as consumer verify, "never creates a user" assertion |
| `src/tests/auth/middleware.test.ts` | `authenticate`: no header, no-space header, bad-token-after-Bearer, expired token, valid token success, rolling-refresh header issued/not-issued at the 50% threshold; `authorize`: wrong role → 403 |

### 9.3 What's *not* covered by these tests
Everything in §8's checklists is untested because it isn't implemented — don't assume rate limiting, rotation, or DB-status-recheck exist just because the auth module has a healthy-looking test suite. The tests validate current behavior, not the target behavior in §8.

---

## 10. File Map (quick jump list)

```
src/routes/auth.route.ts              — route definitions + Swagger JSDoc
src/controllers/auth.controller.ts    — HTTP layer, input validation
src/services/auth.service.ts          — business logic, OTP + token mechanics
src/middlewares/auth.middleware.ts    — authenticate (JWT check + rolling refresh)
src/middlewares/authorize.middleware.ts — role gate
src/middlewares/context.middleware.ts — x-app-id gate (all routes, not auth-specific)
src/utils/validators.ts               — phone/OTP format validation
src/utils/apiResponse.ts              — ApiResponse / ApiError shapes
src/middlewares/errorHandler.ts       — central error → response mapping
src/services/hanuotp.service.ts       — SMS provider integration
prisma/schema.prisma                  — User / Otp / RefreshToken / Wallet models
docs/authentication.md                — this file
src/tests/auth/*.test.ts              — test suites
src/tests/{testApp,dbHelpers,apiClient,globalSetup,globalTeardown,setupEnv}.ts — test infra
jest.config.js, .env.test             — test configuration
```

---

## 11. Change Log

- **2026-09-07** — Initial hardening pass: fixed raw `Error` → `ApiError` (was causing wrong 500s), fixed middleware response shape, added phone/OTP format validation, reworded 4 robotic error messages to be user-friendly (confirmed safe — frontend apps branch on status code only), built full test suite (55 tests) + test DB infra, wrote this doc.
