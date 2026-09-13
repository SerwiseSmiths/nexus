"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startConfigPolling = exports.config = exports.initializeConfig = void 0;
const zod_1 = require("zod");
const configLoader_1 = require("./configLoader");
const logger_1 = require("@/utils/logger");
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['local', 'development', 'production', 'test']).default('local'),
    PORT: zod_1.z.string().transform(Number).default(3000),
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    DATABASE_URL: zod_1.z.string().url(),
    DIRECT_URL: zod_1.z.string().url().optional(),
    CORS_ORIGIN: zod_1.z.string().default('*'),
    JWT_SECRET: zod_1.z.string().min(8),
    JWT_ACCESS_EXPIRY: zod_1.z.string().default('30d'),
    JWT_REFRESH_EXPIRY: zod_1.z.string().default('60d'),
    HANUOTP_API_KEY: zod_1.z.string().optional(),
    HANUOTP_TEMPLATE_SID: zod_1.z.string().default('default'),
    CLOUDINARY_CLOUD_NAME: zod_1.z.string().min(1),
    CLOUDINARY_API_KEY: zod_1.z.string().min(1),
    CLOUDINARY_API_SECRET: zod_1.z.string().min(1),
    OLA_MAPS_API_KEY: zod_1.z.string().min(1),
    SUPABASE_URL: zod_1.z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string().min(1),
    STRAPI_URL: zod_1.z.string().url().default('http://localhost:1337'),
    STRAPI_API_TOKEN: zod_1.z.string().optional(),
    CACHE_TTL_SECONDS: zod_1.z.string().transform(Number).default(300),
    RAZORPAY_KEY_ID: zod_1.z.string().optional(),
    RAZORPAY_KEY_SECRET: zod_1.z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: zod_1.z.string().optional(),
    APP_URL: zod_1.z.string().url().optional(),
    RADIX_OTA_DEPLOY_API_KEY: zod_1.z.string().min(32),
    SERWISE_OTA_DEPLOY_API_KEY: zod_1.z.string().min(32),
    OTA_MIN_BUNDLE_DATE: zod_1.z.string().datetime().default('2026-01-01T00:00:00Z'),
});
const REQUIRED_ENV_KEYS = Object.keys(envSchema.shape).filter((key) => !envSchema.shape[key].isOptional());
let config = {
    port: 3000,
    cors: {
        origin: '*',
    },
    jwt: {},
    hanuOtp: {},
};
exports.config = config;
const initializeConfig = async () => {
    await configLoader_1.ConfigLoader.init(REQUIRED_ENV_KEYS);
    const resolvedEnv = {};
    const schemaKeys = Object.keys(envSchema.shape);
    for (const key of schemaKeys) {
        resolvedEnv[key] = configLoader_1.ConfigLoader.resolve(key);
    }
    const parsed = envSchema.parse(resolvedEnv);
    process.env.DATABASE_URL = parsed.DATABASE_URL;
    if (parsed.DIRECT_URL) {
        process.env.DIRECT_URL = parsed.DIRECT_URL;
    }
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
        hanuOtp: {
            apiKey: parsed.HANUOTP_API_KEY,
            templateSid: parsed.HANUOTP_TEMPLATE_SID,
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
        cache: {
            ttlSeconds: parsed.CACHE_TTL_SECONDS,
        },
        razorpay: {
            keyId: parsed.RAZORPAY_KEY_ID,
            keySecret: parsed.RAZORPAY_KEY_SECRET,
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
exports.initializeConfig = initializeConfig;
const POLL_INTERVAL_MS = 5 * 60 * 1_000;
let _pollingId = null;
const startConfigPolling = () => {
    if (configLoader_1.ConfigLoader.getEnv() === 'local' || _pollingId !== null)
        return;
    _pollingId = setInterval(async () => {
        try {
            await configLoader_1.ConfigLoader.refresh();
            const schemaKeys = Object.keys(envSchema.shape);
            const resolvedEnv = {};
            for (const key of schemaKeys) {
                resolvedEnv[key] = configLoader_1.ConfigLoader.resolve(key);
            }
            const parsed = envSchema.parse(resolvedEnv);
            Object.assign(config, {
                supabase: { url: parsed.SUPABASE_URL, serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY },
                cloudinary: { cloudName: parsed.CLOUDINARY_CLOUD_NAME, apiKey: parsed.CLOUDINARY_API_KEY, apiSecret: parsed.CLOUDINARY_API_SECRET },
                hanuOtp: { apiKey: parsed.HANUOTP_API_KEY, templateSid: parsed.HANUOTP_TEMPLATE_SID },
                razorpay: { keyId: parsed.RAZORPAY_KEY_ID, keySecret: parsed.RAZORPAY_KEY_SECRET, webhookSecret: parsed.RAZORPAY_WEBHOOK_SECRET },
                olaMapsApiKey: parsed.OLA_MAPS_API_KEY,
                strapiUrl: parsed.STRAPI_URL,
                strapiApiToken: parsed.STRAPI_API_TOKEN,
                cache: { ttlSeconds: parsed.CACHE_TTL_SECONDS },
                appUrl: parsed.APP_URL,
            });
            logger_1.logger.info('[Config] Background poll: config refreshed from Remote Config');
        }
        catch (error) {
            logger_1.logger.warn('[Config] Background poll failed:', error);
        }
    }, POLL_INTERVAL_MS);
};
exports.startConfigPolling = startConfigPolling;
//# sourceMappingURL=index.js.map