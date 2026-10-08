-- Read-only: row counts for every table the go-live reset touches or keeps.
-- Run before (to see what will be deleted) and after (to verify).

SELECT 'WIPE' AS action, t.table_name, t.row_count FROM (
            SELECT 'Complaint'           AS table_name, count(*) AS row_count FROM "Complaint"
  UNION ALL SELECT 'ComplaintDevice',     count(*) FROM "ComplaintDevice"
  UNION ALL SELECT 'ComplaintLog',        count(*) FROM "ComplaintLog"
  UNION ALL SELECT 'ComplaintMedia',      count(*) FROM "ComplaintMedia"
  UNION ALL SELECT 'Quote',               count(*) FROM "Quote"
  UNION ALL SELECT 'Notification',        count(*) FROM "Notification"
  UNION ALL SELECT 'Subscription',        count(*) FROM "Subscription"
  UNION ALL SELECT 'SubscriptionService', count(*) FROM "SubscriptionService"
  UNION ALL SELECT 'WalletLedger',        count(*) FROM "WalletLedger"
  UNION ALL SELECT 'PayoutRequest',       count(*) FROM "PayoutRequest"
  UNION ALL SELECT 'PaymentOrder',        count(*) FROM "PaymentOrder"
  UNION ALL SELECT 'PaymentSession',      count(*) FROM "PaymentSession"
  UNION ALL SELECT 'DeviceToken',         count(*) FROM "DeviceToken"
  UNION ALL SELECT 'RefreshToken',        count(*) FROM "RefreshToken"
  UNION ALL SELECT 'Otp',                 count(*) FROM "Otp"
) t
UNION ALL
SELECT 'KEEP', t.table_name, t.row_count FROM (
            SELECT 'User'                   AS table_name, count(*) AS row_count FROM "User"
  UNION ALL SELECT 'Address',                count(*) FROM "Address"
  UNION ALL SELECT 'ProviderProfile',        count(*) FROM "ProviderProfile"
  UNION ALL SELECT 'ProviderBankAccount',    count(*) FROM "ProviderBankAccount"
  UNION ALL SELECT 'Device',                 count(*) FROM "Device"
  UNION ALL SELECT 'DeviceWorkHistory',      count(*) FROM "DeviceWorkHistory"
  UNION ALL SELECT 'DeviceTypeGroup',        count(*) FROM "DeviceTypeGroup"
  UNION ALL SELECT 'ProviderTier',           count(*) FROM "ProviderTier"
  UNION ALL SELECT 'ServicePartTierPricing', count(*) FROM "ServicePartTierPricing"
  UNION ALL SELECT 'bundles',                count(*) FROM "bundles"
  UNION ALL SELECT 'bundle_patches',         count(*) FROM "bundle_patches"
) t
UNION ALL
SELECT 'WALLET', t.label, t.row_count FROM (
            SELECT 'users (customers, not deleted)' AS label, count(*) AS row_count FROM "User" WHERE role = 'CUSTOMER' AND "isDeleted" = false
  UNION ALL SELECT 'users (providers)',  count(*) FROM "User" WHERE role = 'PROVIDER'
  UNION ALL SELECT 'users (admins)',     count(*) FROM "User" WHERE role = 'ADMIN'
  UNION ALL SELECT 'wallets existing',   count(*) FROM "Wallet"
  UNION ALL SELECT 'users without wallet', count(*) FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Wallet" w WHERE w."userId" = u.id)
  UNION ALL SELECT 'wallets with balance > 0', count(*) FROM "Wallet" WHERE balance > 0
) t
ORDER BY 1, 2;
