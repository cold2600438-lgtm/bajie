import 'dotenv/config';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { initializeDatabase, closeDatabase, getDatabase } from './db/database.js';
import { buildApp } from './app.js';
import { KeyValidator } from './services/key-validator.js';
import { decrypt } from './services/crypto.js';
import type { EncryptedData } from './types/index.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // Ensure the data directory exists
  const dbDir = dirname(config.databasePath);
  mkdirSync(dbDir, { recursive: true });

  // Initialize SQLite database
  initializeDatabase(config.databasePath);

  // Build Fastify app
  const app = await buildApp();

  // Validate all configured API keys at startup
  await validateApiKeys(config.encryptionKey, app.log);

  // Start listening
  try {
    const address = await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`AI Token Gateway started on ${address}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Validate all active API keys at startup by sending lightweight
 * requests to their respective provider endpoints.
 */
async function validateApiKeys(
  encryptionKey: string,
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
): Promise<void> {
  const db = getDatabase();
  const validator = new KeyValidator();

  const rows = db.prepare(
    `SELECT ak.id, ak.encrypted_key, ak.encryption_iv, ak.encryption_tag, ak.provider_id,
            p.api_base_url
     FROM api_keys ak
     JOIN providers p ON ak.provider_id = p.id
     WHERE ak.status = 'active'`,
  ).all() as Record<string, unknown>[];

  if (rows.length === 0) {
    logger.info('No API keys configured — skipping startup validation');
    return;
  }

  logger.info(`Validating ${rows.length} API key(s) at startup...`);

  for (const row of rows) {
    const keyId = row.id as string;
    const providerId = row.provider_id as string;
    const baseUrl = row.api_base_url as string;

    const encryptedData: EncryptedData = {
      encrypted: row.encrypted_key as string,
      iv: row.encryption_iv as string,
      tag: row.encryption_tag as string,
    };

    try {
      const apiKey = decrypt(encryptedData, encryptionKey);
      const valid = await validator.validateKey(apiKey, baseUrl);

      if (valid) {
        logger.info(`Key ${keyId} (${providerId}): valid`);
      } else {
        logger.warn(`Key ${keyId} (${providerId}): INVALID — marking as disabled`);
        db.prepare("UPDATE api_keys SET status = 'disabled' WHERE id = ?").run(keyId);
      }
    } catch (err) {
      logger.warn(`Key ${keyId} (${providerId}): validation error — ${err}`);
    }
  }
}

main();
