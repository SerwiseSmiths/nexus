import { z } from 'zod';
import { ConfigLoader } from './configLoader';
import { logger } from '@/utils/logger';

const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'development', 'production', 'test']).default('local'),
  PORT: z.string().transform(Number).default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('*'),
  JWT_SECRET: z.string().min(8),
  JWT_ACCESS_EXPIRY: z.string().default('30d'),
  JWT_REFRESH_EXPIRY: z.string().default('60d'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_WHATSAPP_INTEGRATED_NUMBER: z.string().optional(),
  MSG91_TEMPLATE_NAME: z.string().default('verify'),
  MSG91_TEMPLATE_NAMESPACE: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  OLA_MAPS_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRAPI_URL: z.string().url().default('http://localhost:1337'),
  STRAPI_API_TOKEN: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  APP_URL: z.string().url().optional(),
  // Separate deploy keys per app — enforces that a radix deploy can only
  // touch radix-* channels and a serwise deploy can only touch serwise-*
  // channels (see otaServer.service.ts's scopedDatabaseForApp).
  RADIX_OTA_DEPLOY_API_KEY: z.string().min(32),
  SERWISE_OTA_DEPLOY_API_KEY: z.string().min(32),
  // Server-side rollback floor: no bundle created before this date is ever
  // servable again (including explicit rollback), regardless of what
  // minBundleId a client request sends. Defaults to the policy's original
  // cutoff so the floor still applies even if Firebase Remote Config is
  // ever missing this key for an environment (dev/prod) — never silently
  // falls back to "no floor at all".
  OTA_MIN_BUNDLE_DATE: z.string().datetime().default('2026-01-01T00:00:00Z'),
});

export type Config = z.infer<typeof envSchema>;

let config: any = {
  port: 3000,
  cors: {
    origin: '*',
  },
  jwt: {},
  msg91: {},
};

export const initializeConfig = async () => {
  await ConfigLoader.init();

  // Resolve all keys from the schema using the prefix logic
  const resolvedEnv: any = {};
  const schemaKeys = Object.keys(envSchema.shape);

  for (const key of schemaKeys) {
    resolvedEnv[key] = ConfigLoader.resolve(key);
  }

  const parsed = envSchema.parse(resolvedEnv);

  // Inject resolved variables into process.env for Prisma
  process.env.DATABASE_URL = parsed.DATABASE_URL;
  if (parsed.DIRECT_URL) {
    process.env.DIRECT_URL = parsed.DIRECT_URL;
  }

  // Map to the final config object structure
  Object.assign(config, {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    directUrl: parsed.DIRECT_URL,
    cors: {
      origin: parsed.CORS_ORIGIN,
    },
    jwt: {
      secret: parsed.JWT_SECRET,
      accessExpiry: parsed.JWT_ACCESS_EXPIRY,
      refreshExpiry: parsed.JWT_REFRESH_EXPIRY,
    },
    msg91: {
      authKey: parsed.MSG91_AUTH_KEY,
      integratedNumber: parsed.MSG91_WHATSAPP_INTEGRATED_NUMBER,
      templateName: parsed.MSG91_TEMPLATE_NAME,
      templateNamespace: parsed.MSG91_TEMPLATE_NAMESPACE,
    },
    cloudinary: {
      cloudName: parsed.CLOUDINARY_CLOUD_NAME,
      apiKey: parsed.CLOUDINARY_API_KEY,
      apiSecret: parsed.CLOUDINARY_API_SECRET,
    },
    olaMapsApiKey: parsed.OLA_MAPS_API_KEY,
    supabase: {
      url: parsed.SUPABASE_URL,
      serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    },
    strapiUrl: parsed.STRAPI_URL,
    strapiApiToken: parsed.STRAPI_API_TOKEN,
    razorpay: {
      keyId:         parsed.RAZORPAY_KEY_ID,
      keySecret:     parsed.RAZORPAY_KEY_SECRET,
      webhookSecret: parsed.RAZORPAY_WEBHOOK_SECRET,
    },
    appUrl: parsed.APP_URL,
    ota: {
      radixDeployApiKey: parsed.RADIX_OTA_DEPLOY_API_KEY,
      serwiseDeployApiKey: parsed.SERWISE_OTA_DEPLOY_API_KEY,
      minBundleDate: parsed.OTA_MIN_BUNDLE_DATE,
    },
  });

  return config;
};

export { config };

const POLL_INTERVAL_MS = 5 * 60 * 1_000;
let _pollingId: ReturnType<typeof setInterval> | null = null;

export const startConfigPolling = (): void => {
  if (ConfigLoader.getEnv() === 'local' || _pollingId !== null) return;

  _pollingId = setInterval(async () => {
    try {
      await ConfigLoader.refresh();

      const schemaKeys = Object.keys(envSchema.shape) as string[];
      const resolvedEnv: Record<string, string | undefined> = {};
      for (const key of schemaKeys) {
        resolvedEnv[key] = ConfigLoader.resolve(key);
      }

      const parsed = envSchema.parse(resolvedEnv);

      Object.assign(config, {
        supabase:    { url: parsed.SUPABASE_URL, serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY },
        cloudinary:  { cloudName: parsed.CLOUDINARY_CLOUD_NAME, apiKey: parsed.CLOUDINARY_API_KEY, apiSecret: parsed.CLOUDINARY_API_SECRET },
        msg91:       { authKey: parsed.MSG91_AUTH_KEY, integratedNumber: parsed.MSG91_WHATSAPP_INTEGRATED_NUMBER, templateName: parsed.MSG91_TEMPLATE_NAME, templateNamespace: parsed.MSG91_TEMPLATE_NAMESPACE },
        razorpay:    { keyId: parsed.RAZORPAY_KEY_ID, keySecret: parsed.RAZORPAY_KEY_SECRET, webhookSecret: parsed.RAZORPAY_WEBHOOK_SECRET },
        olaMapsApiKey: parsed.OLA_MAPS_API_KEY,
        strapiUrl:   parsed.STRAPI_URL,
        strapiApiToken: parsed.STRAPI_API_TOKEN,
        appUrl:      parsed.APP_URL,
      });

      logger.info('[Config] Background poll: config refreshed from Remote Config');
    } catch (error) {
      logger.warn('[Config] Background poll failed:', error);
    }
  }, POLL_INTERVAL_MS);
};
