import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { KeyPoolManager } from './key-pool.js';
import { ProxyEngine } from './proxy-engine.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-proxy-engine-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

function seedProvider(providerId: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES (?, ?, ?)`,
  ).run(providerId, providerId, `https://${providerId}.example.com`);
}

function seedUser(userId: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, 'user', 'active')`,
  ).run(userId, `user-${userId.slice(0, 8)}`, randomBytes(32).toString('hex'));
}

describe('ProxyEngine', () => {
  let dbPath: string;
  let keyPool: KeyPoolManager;
  let engine: ProxyEngine;
  const encKey = generateEncryptionKey();
  const provider = 'test-provider';
  const userId = 'test-user-id';

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    seedProvider(provider);
    seedUser(userId);
    keyPool = new KeyPoolManager();
    engine = new ProxyEngine(keyPool);
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  describe('forwardWithRetry', () => {
    it('should return 503 when no keys are available', async () => {
      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async () => ({ statusCode: 200, body: { ok: true } }),
      });

      expect(result.statusCode).toBe(503);
      expect(result.keyId).toBe('');
      expect(result.body).toEqual({
        error: 'Service Unavailable',
        message: `No available API keys for provider '${provider}'`,
      });
    });

    it('should forward successfully on first attempt', async () => {
      keyPool.addKey({ provider, key: 'sk-good', contributorUserId: userId }, encKey);

      const calls: string[] = [];
      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async (apiKey) => {
          calls.push(apiKey);
          return { statusCode: 200, body: { response: 'hello' } };
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ response: 'hello' });
      expect(result.keyId).toBeTruthy();
      expect(calls).toEqual(['sk-good']);
    });

    it('should retry with next key on 429', async () => {
      keyPool.addKey({ provider, key: 'sk-rate-limited', contributorUserId: userId }, encKey);
      keyPool.addKey({ provider, key: 'sk-good', contributorUserId: userId }, encKey);

      const calls: string[] = [];
      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async (apiKey) => {
          calls.push(apiKey);
          if (apiKey === 'sk-rate-limited') {
            return { statusCode: 429, body: { error: 'rate limited' } };
          }
          return { statusCode: 200, body: { ok: true } };
        },
      });

      expect(result.statusCode).toBe(200);
      expect(calls).toEqual(['sk-rate-limited', 'sk-good']);
    });

    it('should retry with next key on 402', async () => {
      keyPool.addKey({ provider, key: 'sk-no-quota', contributorUserId: userId }, encKey);
      keyPool.addKey({ provider, key: 'sk-has-quota', contributorUserId: userId }, encKey);

      const calls: string[] = [];
      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async (apiKey) => {
          calls.push(apiKey);
          if (apiKey === 'sk-no-quota') {
            return { statusCode: 402, body: { error: 'payment required' } };
          }
          return { statusCode: 200, body: { ok: true } };
        },
      });

      expect(result.statusCode).toBe(200);
      expect(calls).toEqual(['sk-no-quota', 'sk-has-quota']);
    });

    it('should return 503 when all keys fail with 429/402', async () => {
      keyPool.addKey({ provider, key: 'sk-bad-1', contributorUserId: userId }, encKey);
      keyPool.addKey({ provider, key: 'sk-bad-2', contributorUserId: userId }, encKey);

      const calls: string[] = [];
      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async (apiKey) => {
          calls.push(apiKey);
          return { statusCode: 429, body: { error: 'rate limited' } };
        },
      });

      expect(result.statusCode).toBe(503);
      expect(result.keyId).toBe('');
      expect(calls).toHaveLength(2);
    });

    it('should mark key as successful on non-429/402 response', async () => {
      const entry = keyPool.addKey({ provider, key: 'sk-ok', contributorUserId: userId }, encKey);

      // Add a failure first
      keyPool.markKeyFailure(entry.id);

      await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async () => ({ statusCode: 200, body: {} }),
      });

      // Check that consecutive failures were reset
      const db = getDatabase();
      const row = db.prepare('SELECT consecutive_failures FROM api_keys WHERE id = ?').get(entry.id) as Record<string, unknown>;
      expect(row.consecutive_failures).toBe(0);
    });

    it('should mark key as failed on 429 response', async () => {
      keyPool.addKey({ provider, key: 'sk-fail', contributorUserId: userId }, encKey);

      await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async () => ({ statusCode: 429, body: { error: 'rate limited' } }),
      });

      const db = getDatabase();
      const rows = db.prepare('SELECT consecutive_failures FROM api_keys').all() as Record<string, unknown>[];
      expect(rows[0].consecutive_failures).toBe(1);
    });

    it('should pass through non-retryable error status codes', async () => {
      keyPool.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      keyPool.addKey({ provider, key: 'sk-2', contributorUserId: userId }, encKey);

      const calls: string[] = [];
      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async (apiKey) => {
          calls.push(apiKey);
          return { statusCode: 400, body: { error: 'bad request' } };
        },
      });

      // Should NOT retry on 400 — only 429/402 trigger retry
      expect(result.statusCode).toBe(400);
      expect(calls).toHaveLength(1);
    });

    it('should return the keyId of the successful key', async () => {
      keyPool.addKey({ provider, key: 'sk-fail', contributorUserId: userId }, encKey);
      const goodEntry = keyPool.addKey({ provider, key: 'sk-good', contributorUserId: userId }, encKey);

      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async (apiKey) => {
          if (apiKey === 'sk-fail') {
            return { statusCode: 429, body: {} };
          }
          return { statusCode: 200, body: { ok: true } };
        },
      });

      expect(result.keyId).toBe(goodEntry.id);
    });

    it('should not retry more times than the number of active keys', async () => {
      keyPool.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      keyPool.addKey({ provider, key: 'sk-2', contributorUserId: userId }, encKey);
      keyPool.addKey({ provider, key: 'sk-3', contributorUserId: userId }, encKey);

      let callCount = 0;
      await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async () => {
          callCount++;
          return { statusCode: 429, body: {} };
        },
      });

      expect(callCount).toBe(3);
    });

    it('should handle a single key that succeeds', async () => {
      keyPool.addKey({ provider, key: 'only-key', contributorUserId: userId }, encKey);

      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async () => ({ statusCode: 200, body: { data: 'result' } }),
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ data: 'result' });
    });

    it('should handle a single key that fails', async () => {
      keyPool.addKey({ provider, key: 'only-key', contributorUserId: userId }, encKey);

      const result = await engine.forwardWithRetry({
        provider,
        encryptionKey: encKey,
        forwardFn: async () => ({ statusCode: 429, body: { error: 'rate limited' } }),
      });

      expect(result.statusCode).toBe(503);
    });

    it('should return 503 for unknown provider with no keys', async () => {
      const result = await engine.forwardWithRetry({
        provider: 'nonexistent-provider',
        encryptionKey: encKey,
        forwardFn: async () => ({ statusCode: 200, body: {} }),
      });

      expect(result.statusCode).toBe(503);
    });
  });
});
