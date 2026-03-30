import 'dotenv/config';
import type { AppConfig } from './types/index.js';

/**
 * 从环境变量加载配置，提供默认值并校验必填项。
 */
export function loadConfig(): AppConfig {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: must be a number between 1 and 65535`);
  }

  const databasePath = process.env.DATABASE_PATH ?? './data/gateway.db';

  const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is required');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  const adminToken = process.env.ADMIN_TOKEN ?? '';
  if (!adminToken) {
    throw new Error('ADMIN_TOKEN is required');
  }

  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX ?? '60', 10);
  if (isNaN(rateLimitMax) || rateLimitMax < 1) {
    throw new Error('RATE_LIMIT_MAX must be a positive integer');
  }

  const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
  if (isNaN(rateLimitWindowMs) || rateLimitWindowMs < 1000) {
    throw new Error('RATE_LIMIT_WINDOW_MS must be at least 1000');
  }

  return {
    port,
    databasePath,
    encryptionKey,
    adminToken,
    rateLimitMax,
    rateLimitWindowMs,
  };
}
