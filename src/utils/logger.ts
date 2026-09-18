import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  // winston merges a logger.warn(msg, { ...metadata }) call's object arg
  // directly into `info` as top-level fields (JSON.stringify below drops
  // winston's own Symbol-keyed fields automatically) — without this,
  // anything passed that way (errorCode, userId, etc.) was silently
  // dropped from every log line instead of just not being pretty-printed.
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize({ all: true }), logFormat),
    }),
  ],
});
