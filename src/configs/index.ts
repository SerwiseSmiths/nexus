import { z } from 'zod';
import { ConfigLoader } from './configLoader';

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
  });

  return config;
};

export { config };
