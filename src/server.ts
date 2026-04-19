import 'dotenv/config';
import app from './app';
import { config, initializeConfig } from '@/configs';
import { logger } from '@/utils/logger';

const startServer = async () => {
  try {
    await initializeConfig();

    const server = app.listen(config.port, () => {
      logger.info(`Nexus Backend started in ${config.env} mode on port ${config.port}`);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
