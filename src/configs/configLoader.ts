import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initializeFirebase } from './firebase.admin';
import { logger } from '@/utils/logger';

export type ConfigSource = 'local' | 'development' | 'production' | 'test';

export class ConfigLoader {
  private static rawPool: Record<string, string> = {};
  private static activeEnv: ConfigSource = 'local';

  static async init(): Promise<void> {
    // 1. Load base .env
    dotenv.config();

    // 2. Determine environment
    const nodeEnv = (process.env.NODE_ENV || 'local') as ConfigSource;
    this.activeEnv = nodeEnv;

    // 3. Load stage-specific .env file
    const envFile = `.env.${nodeEnv}`;
    const envPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      const specificEnv = dotenv.parse(fs.readFileSync(envPath));
      Object.assign(process.env, specificEnv);
      logger.info(`Loaded environment overrides from ${envFile}`);
    }

    // Initialize rawPool from current process.env
    this.rawPool = { ...process.env } as Record<string, string>;

    // 4. Fetch from Firebase Remote Config if not local
    if (nodeEnv === 'development' || nodeEnv === 'production') {
      await this.fetchRemoteConfig();
    }
  }

  private static async fetchRemoteConfig() {
    const admin = initializeFirebase();
    if (!admin) {
      if (this.activeEnv === 'production') {
        throw new Error(
          'Firebase Admin failed to initialize. Ensure FIREBASE_SERVICE_ACCOUNT is set in production environment variables.'
        );
      }
      return;
    }

    try {
      logger.info('Fetching Firebase Remote Config...');
      const template = await admin.remoteConfig().getTemplate();
      const parameters = template.parameters;

      for (const [key, param] of Object.entries(parameters)) {
        if (param.defaultValue && 'value' in param.defaultValue) {
          this.rawPool[key] = param.defaultValue.value;
        }
      }
      logger.info(`Fetched ${Object.keys(parameters).length} parameters from Remote Config.`);
      logger.info(`Remote Config keys: [${Object.keys(parameters).join(', ')}]`);
      logger.info(`DATABASE_URL resolved: ${this.rawPool['DEV_DATABASE_URL'] ? 'DEV_DATABASE_URL ✓' : this.rawPool['DATABASE_URL'] ? 'DATABASE_URL ✓' : 'NOT FOUND ✗'}`);
    } catch (error) {
      logger.error('Failed to fetch Remote Config:', error);
      if (this.activeEnv === 'production') {
        throw new Error('Production config fetch failed. Aborting startup.');
      }
    }
  }

  /**
   * Resolves a key using prefix priority:
   * 1. PRE_KEY (LOCAL_VAR, DEV_VAR, PROD_VAR)
   * 2. KEY (VAR)
   */
  static resolve(key: string): string | undefined {
    let prefix = '';
    switch (this.activeEnv) {
      case 'local': prefix = 'LOCAL_'; break;
      case 'development': prefix = 'DEV_'; break;
      case 'production': prefix = 'PROD_'; break;
    }

    const prefixedKey = `${prefix}${key}`;
    return this.rawPool[prefixedKey] || this.rawPool[key];
  }

  static getEnv(): ConfigSource {
    return this.activeEnv;
  }
}
