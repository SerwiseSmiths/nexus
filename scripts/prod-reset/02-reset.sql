-- Go-live data reset (2026-09-27).
--
-- KEEPS: User, Address, ProviderProfile (+ skill groups join), ProviderBankAccount,
--        Device, DeviceWorkHistory, and all config/reference tables
--        (DeviceTypeGroup, ProviderTier, ServicePartTierPricing, bundles,
--        bundle_patches). Tables not named below — e.g. anything watchtower
--        keeps in this database — are never touched.
-- WIPES: complaints and everything hanging off them, notifications, device
--        tokens, payments, subscriptions, wallet history, payout requests,
--        OTPs, and refresh tokens (everyone signs in again).
-- WALLETS: every user gets exactly one wallet; customers (not deleted) start
--        at ₹50 as a welcome bonus with a matching ledger entry, everyone else
--        (providers, admins, deleted users) at ₹0.
--
-- One transaction: any error rolls the whole thing back. Take the pg_dump
-- backup BEFORE running this.

\set ON_ERROR_STOP on
BEGIN;

-- ── Complaint children (FKs point at Complaint) ─────────────────────────────
DELETE FROM "ComplaintDevice";
DELETE FROM "ComplaintLog";
DELETE FROM "ComplaintMedia";
DELETE FROM "Quote";
DELETE FROM "Notification";
DELETE FROM "SubscriptionService";

-- Reopened complaints point at their parent — clear first so one DELETE
-- doesn't trip the self-reference.
UPDATE "Complaint" SET "parentId" = NULL WHERE "parentId" IS NOT NULL;
DELETE FROM "Complaint";

DELETE FROM "Subscription";

-- ── Money, sessions, tokens ─────────────────────────────────────────────────
DELETE FROM "WalletLedger";
DELETE FROM "PayoutRequest";
DELETE FROM "PaymentOrder";
DELETE FROM "PaymentSession";
DELETE FROM "DeviceToken";
DELETE FROM "RefreshToken";
DELETE FROM "Otp";

-- ── Wallets ─────────────────────────────────────────────────────────────────
-- One wallet per user (nexus expects it to exist).
INSERT INTO "Wallet" (id, "userId", "walletType", balance, "isActive", "isDeleted", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       u.id,
       CASE WHEN u.role = 'PROVIDER' THEN 'PROVIDER'::"WalletType" ELSE 'CUSTOMER'::"WalletType" END,
       0, true, false, now(), now()
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Wallet" w WHERE w."userId" = u.id);

-- Everyone to zero…
UPDATE "Wallet" SET balance = 0, "updatedAt" = now();

-- …then the ₹50 welcome bonus for customers, recorded the same way nexus
-- records the sign-up bonus (CASHBACK, meta.reason = welcome_bonus).
INSERT INTO "WalletLedger" (id, "walletId", "userId", type, source, amount,
                            "openingBalance", "closingBalance", meta,
                            "updateBalance", "isDeleted", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w.id, w."userId",
       'CREDIT'::"WalletLedgerType", 'CASHBACK'::"WalletLedgerSource", 50,
       0, 50, '{"reason":"welcome_bonus"}'::jsonb,
       true, false, now(), now()
FROM "Wallet" w
JOIN "User" u ON u.id = w."userId"
WHERE u.role = 'CUSTOMER' AND u."isDeleted" = false;

UPDATE "Wallet" w
SET balance = 50, "updatedAt" = now()
FROM "User" u
WHERE u.id = w."userId" AND u.role = 'CUSTOMER' AND u."isDeleted" = false;

-- ── Sanity checks — abort (roll back) if anything is off ────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM "Complaint") <> 0 THEN
    RAISE EXCEPTION 'Complaints not fully deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Wallet" w WHERE w."userId" = u.id)) THEN
    RAISE EXCEPTION 'Some users still have no wallet';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Wallet" w JOIN "User" u ON u.id = w."userId"
    WHERE (u.role = 'CUSTOMER' AND u."isDeleted" = false AND w.balance <> 50)
       OR (NOT (u.role = 'CUSTOMER' AND u."isDeleted" = false) AND w.balance <> 0)
  ) THEN
    RAISE EXCEPTION 'Wallet balances not as expected';
  END IF;
END $$;

COMMIT;
