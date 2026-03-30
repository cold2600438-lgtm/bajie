import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { KeyPoolManager } from './key-pool.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-key-pool-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

/** Seed a provider row so foreign key constraints are satisfied. */
function seedProvider(providerId: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES (?, ?, ?)`,
  ).run(providerId, providerId, `https://${providerId}.example.com`);
}

/** Seed a user row so foreign key constraints are satisfied. */
function seedUser(userId: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, 'user', 'active')`,
  ).run(userId, `user-${userId.slice(0, 8)}`, randomBytes(32).toString('hex'));
}

describe('KeyPoolManager', () => {
  let dbPath: string;
  let mgr: KeyPoolManager;
  const encKey = generateEncryptionKey();
  const provider = 'test-provider';
  const userId = 'test-user-id';

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    seedProvider(provider);
    seedUser(userId);
    mgr = new KeyPoolManager();
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  // --- addKey ---

  describe('addKey', () => {
    it('should add a key and return an ApiKeyEntry', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-secret-123', contributorUserId: userId },
        encKey,
      );
      expect(entry.id).toBeDefined();
      expect(entry.provider).toBe(provider);
      expect(entry.status).toBe('active');
      expect(entry.consecutiveFailures).toBe(0);
      expect(entry.encryptedKey).not.toBe('sk-secret-123');
    });

    it('should persist the key in the database', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-abc', contributorUserId: userId },
        encKey,
      );
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(entry.id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.provider_id).toBe(provider);
      expect(row.status).toBe('active');
    });

    it('should make the key available in active keys', () => {
      mgr.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      expect(mgr.getActiveKeyIds(provider)).toHaveLength(1);
    });

    it('should store estimated quota', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-q', contributorUserId: userId, estimatedQuota: 5000 },
        encKey,
      );
      expect(entry.estimatedQuota).toBe(5000);
    });
  });

  // --- removeKey ---

  describe('removeKey', () => {
    it('should remove a key from DB and memory', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-rm', contributorUserId: userId },
        encKey,
      );
      mgr.removeKey(entry.id);
      expect(mgr.getActiveKeyIds(provider)).toHaveLength(0);

      const db = getDatabase();
      const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(entry.id);
      expect(row).toBeUndefined();
    });

    it('should throw for non-existent key', () => {
      expect(() => mgr.removeKey('nonexistent')).toThrow('API key not found');
    });

    it('should not affect other keys for the same provider', () => {
      const k1 = mgr.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      const k2 = mgr.addKey({ provider, key: 'sk-2', contributorUserId: userId }, encKey);
      mgr.removeKey(k1.id);
      expect(mgr.getActiveKeyIds(provider)).toEqual([k2.id]);
    });
  });

  // --- getNextKey ---

  describe('getNextKey', () => {
    it('should return null when no keys exist for provider', () => {
      expect(mgr.getNextKey('no-such-provider', encKey)).toBeNull();
    });

    it('should return a decrypted key', () => {
      mgr.addKey({ provider, key: 'sk-my-secret', contributorUserId: userId }, encKey);
      const result = mgr.getNextKey(provider, encKey);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('sk-my-secret');
      expect(result!.provider).toBe(provider);
    });

    it('should round-robin across multiple keys', () => {
      mgr.addKey({ provider, key: 'key-A', contributorUserId: userId }, encKey);
      mgr.addKey({ provider, key: 'key-B', contributorUserId: userId }, encKey);
      mgr.addKey({ provider, key: 'key-C', contributorUserId: userId }, encKey);

      const results: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = mgr.getNextKey(provider, encKey);
        results.push(r!.key);
      }

      // Should cycle: A, B, C, A, B, C
      expect(results).toEqual(['key-A', 'key-B', 'key-C', 'key-A', 'key-B', 'key-C']);
    });

    it('should work with a single key', () => {
      mgr.addKey({ provider, key: 'only-key', contributorUserId: userId }, encKey);
      const r1 = mgr.getNextKey(provider, encKey);
      const r2 = mgr.getNextKey(provider, encKey);
      expect(r1!.key).toBe('only-key');
      expect(r2!.key).toBe('only-key');
    });
  });

  // --- markKeyFailure ---

  describe('markKeyFailure', () => {
    it('should increment consecutive failures', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-fail', contributorUserId: userId },
        encKey,
      );
      mgr.markKeyFailure(entry.id);

      const db = getDatabase();
      const row = db.prepare('SELECT consecutive_failures, status FROM api_keys WHERE id = ?').get(entry.id) as Record<string, unknown>;
      expect(row.consecutive_failures).toBe(1);
      expect(row.status).toBe('active');
    });

    it('should mark as exhausted after 3 consecutive failures', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-exhaust', contributorUserId: userId },
        encKey,
      );
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);

      const db = getDatabase();
      const row = db.prepare('SELECT consecutive_failures, status FROM api_keys WHERE id = ?').get(entry.id) as Record<string, unknown>;
      expect(row.consecutive_failures).toBe(3);
      expect(row.status).toBe('exhausted');
    });

    it('should remove exhausted key from active pool', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-gone', contributorUserId: userId },
        encKey,
      );
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);

      expect(mgr.getActiveKeyIds(provider)).not.toContain(entry.id);
    });

    it('should not affect other keys when one is exhausted', () => {
      const k1 = mgr.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      const k2 = mgr.addKey({ provider, key: 'sk-2', contributorUserId: userId }, encKey);

      // Exhaust k1
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);

      const active = mgr.getActiveKeyIds(provider);
      expect(active).toContain(k2.id);
      expect(active).not.toContain(k1.id);
    });

    it('should throw for non-existent key', () => {
      expect(() => mgr.markKeyFailure('nonexistent')).toThrow('API key not found');
    });
  });

  // --- markKeySuccess ---

  describe('markKeySuccess', () => {
    it('should reset consecutive failures to 0', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-ok', contributorUserId: userId },
        encKey,
      );
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);
      mgr.markKeySuccess(entry.id);

      const db = getDatabase();
      const row = db.prepare('SELECT consecutive_failures FROM api_keys WHERE id = ?').get(entry.id) as Record<string, unknown>;
      expect(row.consecutive_failures).toBe(0);
    });

    it('should throw for non-existent key', () => {
      expect(() => mgr.markKeySuccess('nonexistent')).toThrow('API key not found');
    });
  });

  // --- getActiveKeyIds ---

  describe('getActiveKeyIds', () => {
    it('should return empty array for unknown provider', () => {
      expect(mgr.getActiveKeyIds('unknown')).toEqual([]);
    });

    it('should return all active key IDs for a provider', () => {
      const k1 = mgr.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      const k2 = mgr.addKey({ provider, key: 'sk-2', contributorUserId: userId }, encKey);
      const ids = mgr.getActiveKeyIds(provider);
      expect(ids).toContain(k1.id);
      expect(ids).toContain(k2.id);
      expect(ids).toHaveLength(2);
    });
  });

  // --- loadActiveKeys ---

  describe('loadActiveKeys', () => {
    it('should load active keys from DB into memory', () => {
      mgr.addKey({ provider, key: 'sk-load-1', contributorUserId: userId }, encKey);
      mgr.addKey({ provider, key: 'sk-load-2', contributorUserId: userId }, encKey);

      // Create a fresh manager and load
      const mgr2 = new KeyPoolManager();
      expect(mgr2.getActiveKeyIds(provider)).toHaveLength(0);

      mgr2.loadActiveKeys();
      expect(mgr2.getActiveKeyIds(provider)).toHaveLength(2);
    });

    it('should not load exhausted keys', () => {
      const entry = mgr.addKey(
        { provider, key: 'sk-exhaust', contributorUserId: userId },
        encKey,
      );
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);
      mgr.markKeyFailure(entry.id);

      const mgr2 = new KeyPoolManager();
      mgr2.loadActiveKeys();
      expect(mgr2.getActiveKeyIds(provider)).not.toContain(entry.id);
    });
  });

  // --- getKeyCount ---

  describe('getKeyCount', () => {
    it('should return 0/0 for unknown provider', () => {
      expect(mgr.getKeyCount('unknown')).toEqual({ active: 0, total: 0 });
    });

    it('should count active and total keys', () => {
      const k1 = mgr.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);
      mgr.addKey({ provider, key: 'sk-2', contributorUserId: userId }, encKey);

      // Exhaust k1
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);

      const count = mgr.getKeyCount(provider);
      expect(count.total).toBe(2);
      expect(count.active).toBe(1);
    });
  });

  // --- round-robin after exhaustion ---

  describe('round-robin after key exhaustion', () => {
    it('should skip exhausted keys and continue round-robin', () => {
      const k1 = mgr.addKey({ provider, key: 'key-A', contributorUserId: userId }, encKey);
      mgr.addKey({ provider, key: 'key-B', contributorUserId: userId }, encKey);

      // Exhaust key-A
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);

      // All subsequent calls should return key-B
      const r1 = mgr.getNextKey(provider, encKey);
      const r2 = mgr.getNextKey(provider, encKey);
      expect(r1!.key).toBe('key-B');
      expect(r2!.key).toBe('key-B');
    });

    it('should return null when all keys are exhausted', () => {
      const k1 = mgr.addKey({ provider, key: 'sk-1', contributorUserId: userId }, encKey);

      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);
      mgr.markKeyFailure(k1.id);

      expect(mgr.getNextKey(provider, encKey)).toBeNull();
    });
  });
});
