import 'module-alias/register';
import app from './app';
import { config } from '@/configs';
import { logger } from '@/utils/logger';

const server = app.listen(config.port, () => {
  logger.info(`Nexus Backend started in ${config.env} mode on port ${config.port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});
