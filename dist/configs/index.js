"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const tslib_1 = require("tslib");
const dotenv_1 = tslib_1.__importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.string().transform(Number).default(3000),
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    CORS_ORIGIN: zod_1.z.string().default('*'),
    JWT_SECRET: zod_1.z.string().min(8),
});
const env = envSchema.parse(process.env);
exports.config = {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    cors: {
        origin: env.CORS_ORIGIN,
    },
    jwt: {
        secret: env.JWT_SECRET,
    },
};
//# sourceMappingURL=index.js.map