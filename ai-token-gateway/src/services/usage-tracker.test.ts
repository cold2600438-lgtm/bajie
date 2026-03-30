import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { UsageTracker } from './usage-tracker.js';
import type { UsageEntry, TimeRange } from '../types/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-usage-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

/** Seed required foreign-key rows so token_usage inserts succeed. */
function seedDependencies() {
  const db = getDatabase();
  db.exec(`INSERT OR IGNORE INTO users (id, username, access_token) VALUES ('u1', 'alice', 'tok1')`);
  db.exec(`INSERT OR IGNORE INTO users (id, username, access_token) VALUES ('u2', 'bob', 'tok2')`);
  db.exec(`INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES ('kimi', 'Kimi', 'https://kimi.example.com')`);
  db.exec(`INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES ('glm', 'GLM', 'https://glm.example.com')`);
  db.exec(`
    INSERT OR IGNORE INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id)
    VALUES ('k1', 'kimi', 'enc', 'iv', 'tag', 'u1')
  `);
  db.exec(`
    INSERT OR IGNORE INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id)
    VALUES ('k2', 'glm', 'enc', 'iv', 'tag', 'u2')
  `);
}

function makeEntry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    userId: 'u1',
    provider: 'kimi',
    apiKeyId: 'k1',
    model: 'test-model',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    timestamp: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('UsageTracker', () => {
  let dbPath: string;
  let tracker: UsageTracker;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    seedDependencies();
    tracker = new UsageTracker();
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  // --- record ---

  describe('record', () => {
    it('should insert a usage row into token_usage', () => {
      tracker.record(makeEntry());
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM token_usage WHERE user_id = ?').get('u1') as any;
      expect(row).toBeDefined();
      expect(row.prompt_tokens).toBe(100);
      expect(row.completion_tokens).toBe(50);
      expect(row.total_tokens).toBe(150);
      expect(row.model).toBe('test-model');
    });

    it('should store the correct timestamp', () => {
      tracker.record(makeEntry({ timestamp: new Date('2024-03-20T14:30:00Z') }));
      const db = getDatabase();
      const row = db.prepare('SELECT created_at FROM token_usage WHERE user_id = ?').get('u1') as any;
      expect(row.created_at).toContain('2024-03-20');
    });

    it('should allow multiple records for the same user', () => {
      tracker.record(makeEntry());
      tracker.record(makeEntry({ promptTokens: 200, completionTokens: 100, totalTokens: 300 }));
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM token_usage WHERE user_id = ?').all('u1');
      expect(rows).toHaveLength(2);
    });
  });

  // --- getUserUsage with day granularity ---

  describe('getUserUsage - day', () => {
    it('should aggregate usage by day', () => {
      tracker.record(makeEntry({ timestamp: new Date('2024-01-15T08:00:00Z') }));
      tracker.record(makeEntry({ timestamp: new Date('2024-01-15T16:00:00Z'), promptTokens: 200, completionTokens: 100, totalTokens: 300 }));
      tracker.record(makeEntry({ timestamp: new Date('2024-01-16T10:00:00Z'), promptTokens: 50, completionTokens: 25, totalTokens: 75 }));

      const range: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-16T23:59:59Z'),
      };
      const result = tracker.getUserUsage('u1', range, 'day');

      expect(result).toHaveLength(2);
      expect(result[0].period).toBe('2024-01-15');
      expect(result[0].promptTokens).toBe(300);
      expect(result[0].completionTokens).toBe(150);
      expect(result[0].totalTokens).toBe(450);

      expect(result[1].period).toBe('2024-01-16');
      expect(result[1].promptTokens).toBe(50);
    });

    it('should return empty array when no data in range', () => {
      tracker.record(makeEntry({ timestamp: new Date('2024-01-15T10:00:00Z') }));
      const range: TimeRange = {
        start: new Date('2024-02-01T00:00:00Z'),
        end: new Date('2024-02-28T23:59:59Z'),
      };
      expect(tracker.getUserUsage('u1', range, 'day')).toEqual([]);
    });

    it('should only return data for the specified user', () => {
      tracker.record(makeEntry({ userId: 'u1', timestamp: new Date('2024-01-15T10:00:00Z') }));
      tracker.record(makeEntry({ userId: 'u2', provider: 'glm', apiKeyId: 'k2', timestamp: new Date('2024-01-15T10:00:00Z') }));

      const range: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };
      const result = tracker.getUserUsage('u1', range, 'day');
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('u1');
    });
  });

  // --- getUserUsage with week granularity ---

  describe('getUserUsage - week', () => {
    it('should aggregate usage by week with correct period format', () => {
      // 2024-01-15 is in week 03
      tracker.record(makeEntry({ timestamp: new Date('2024-01-15T10:00:00Z') }));
      tracker.record(makeEntry({ timestamp: new Date('2024-01-17T10:00:00Z'), promptTokens: 200, completionTokens: 100, totalTokens: 300 }));

      const range: TimeRange = {
        start: new Date('2024-01-14T00:00:00Z'),
        end: new Date('2024-01-20T23:59:59Z'),
      };
      const result = tracker.getUserUsage('u1', range, 'week');

      expect(result).toHaveLength(1);
      expect(result[0].period).toMatch(/^2024-W\d{2}$/);
      expect(result[0].promptTokens).toBe(300);
      expect(result[0].totalTokens).toBe(450);
    });
  });

  // --- getUserUsage with month granularity ---

  describe('getUserUsage - month', () => {
    it('should aggregate usage by month with correct period format', () => {
      tracker.record(makeEntry({ timestamp: new Date('2024-01-10T10:00:00Z') }));
      tracker.record(makeEntry({ timestamp: new Date('2024-01-25T10:00:00Z'), promptTokens: 200, completionTokens: 100, totalTokens: 300 }));
      tracker.record(makeEntry({ timestamp: new Date('2024-02-05T10:00:00Z'), promptTokens: 50, completionTokens: 25, totalTokens: 75 }));

      const range: TimeRange = {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-02-28T23:59:59Z'),
      };
      const result = tracker.getUserUsage('u1', range, 'month');

      expect(result).toHaveLength(2);
      expect(result[0].period).toBe('2024-01');
      expect(result[0].promptTokens).toBe(300);
      expect(result[1].period).toBe('2024-02');
      expect(result[1].promptTokens).toBe(50);
    });
  });

  // --- getUserUsage groups by provider ---

  describe('getUserUsage - provider grouping', () => {
    it('should return separate rows per provider', () => {
      tracker.record(makeEntry({ provider: 'kimi', apiKeyId: 'k1', timestamp: new Date('2024-01-15T10:00:00Z') }));
      tracker.record(makeEntry({ provider: 'glm', apiKeyId: 'k2', timestamp: new Date('2024-01-15T12:00:00Z') }));

      const range: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };
      const result = tracker.getUserUsage('u1', range, 'day');

      expect(result).toHaveLength(2);
      const providers = result.map((r) => r.provider).sort();
      expect(providers).toEqual(['glm', 'kimi']);
    });
  });

  // --- getAllUsage ---

  describe('getAllUsage', () => {
    it('should return usage for all users grouped by user, provider, and month', () => {
      tracker.record(makeEntry({ userId: 'u1', timestamp: new Date('2024-01-15T10:00:00Z') }));
      tracker.record(makeEntry({ userId: 'u2', provider: 'glm', apiKeyId: 'k2', timestamp: new Date('2024-01-20T10:00:00Z') }));

      const range: TimeRange = {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-01-31T23:59:59Z'),
      };
      const result = tracker.getAllUsage(range);

      expect(result).toHaveLength(2);
      const userIds = result.map((r) => r.userId).sort();
      expect(userIds).toEqual(['u1', 'u2']);
    });

    it('should return empty array when no data in range', () => {
      const range: TimeRange = {
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-31T23:59:59Z'),
      };
      expect(tracker.getAllUsage(range)).toEqual([]);
    });

    it('should aggregate multiple records for the same user/provider/month', () => {
      tracker.record(makeEntry({ userId: 'u1', timestamp: new Date('2024-01-10T10:00:00Z') }));
      tracker.record(makeEntry({ userId: 'u1', timestamp: new Date('2024-01-20T10:00:00Z'), promptTokens: 200, completionTokens: 100, totalTokens: 300 }));

      const range: TimeRange = {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-01-31T23:59:59Z'),
      };
      const result = tracker.getAllUsage(range);

      expect(result).toHaveLength(1);
      expect(result[0].promptTokens).toBe(300);
      expect(result[0].completionTokens).toBe(150);
      expect(result[0].totalTokens).toBe(450);
      expect(result[0].period).toBe('2024-01');
    });
  });
});
