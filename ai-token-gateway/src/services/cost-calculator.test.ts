import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { CostCalculator } from './cost-calculator.js';
import type { TimeRange } from '../types/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-cost-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

/** Seed users, providers (with pricing), api_keys, and token_usage rows. */
function seedDependencies() {
  const db = getDatabase();
  db.exec(`INSERT OR IGNORE INTO users (id, username, access_token) VALUES ('u1', 'alice', 'tok1')`);
  db.exec(`INSERT OR IGNORE INTO users (id, username, access_token) VALUES ('u2', 'bob', 'tok2')`);
  db.exec(`
    INSERT OR IGNORE INTO providers (id, name, api_base_url, prompt_price_per_k_token, completion_price_per_k_token)
    VALUES ('kimi', 'Kimi', 'https://kimi.example.com', 0.5, 1.0)
  `);
  db.exec(`
    INSERT OR IGNORE INTO providers (id, name, api_base_url, prompt_price_per_k_token, completion_price_per_k_token)
    VALUES ('glm', 'GLM', 'https://glm.example.com', 0.3, 0.6)
  `);
  db.exec(`
    INSERT OR IGNORE INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id)
    VALUES ('k1', 'kimi', 'enc', 'iv', 'tag', 'u1')
  `);
  db.exec(`
    INSERT OR IGNORE INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id)
    VALUES ('k2', 'glm', 'enc', 'iv', 'tag', 'u2')
  `);
}

function insertUsage(
  userId: string,
  providerId: string,
  apiKeyId: string,
  promptTokens: number,
  completionTokens: number,
  createdAt: string,
) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO token_usage (user_id, provider_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)
    VALUES (?, ?, ?, 'test-model', ?, ?, ?, ?)
  `).run(userId, providerId, apiKeyId, promptTokens, completionTokens, promptTokens + completionTokens, createdAt);
}

const JAN_RANGE: TimeRange = {
  start: new Date('2024-01-01T00:00:00Z'),
  end: new Date('2024-01-31T23:59:59Z'),
};

describe('CostCalculator', () => {
  let dbPath: string;
  let calculator: CostCalculator;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    seedDependencies();
    calculator = new CostCalculator();
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  describe('generateReport', () => {
    it('should return empty report when no usage in range', () => {
      const report = calculator.generateReport(JAN_RANGE);
      expect(report.entries).toEqual([]);
      expect(report.totalCost).toBe(0);
      expect(report.timeRange).toBe(JAN_RANGE);
    });

    it('should calculate cost for a single user and provider', () => {
      // kimi pricing: prompt=0.5/k, completion=1.0/k
      insertUsage('u1', 'kimi', 'k1', 1000, 500, '2024-01-15 10:00:00');

      const report = calculator.generateReport(JAN_RANGE);

      expect(report.entries).toHaveLength(1);
      const entry = report.entries[0];
      expect(entry.userId).toBe('u1');
      expect(entry.provider).toBe('kimi');
      expect(entry.promptTokens).toBe(1000);
      expect(entry.completionTokens).toBe(500);
      // promptCost = 1000 * 0.5 / 1000 = 0.5
      expect(entry.promptCost).toBeCloseTo(0.5);
      // completionCost = 500 * 1.0 / 1000 = 0.5
      expect(entry.completionCost).toBeCloseTo(0.5);
      expect(entry.totalCost).toBeCloseTo(1.0);
      expect(report.totalCost).toBeCloseTo(1.0);
    });

    it('should aggregate multiple usage records for the same user/provider', () => {
      insertUsage('u1', 'kimi', 'k1', 1000, 500, '2024-01-10 10:00:00');
      insertUsage('u1', 'kimi', 'k1', 2000, 1000, '2024-01-20 10:00:00');

      const report = calculator.generateReport(JAN_RANGE);

      expect(report.entries).toHaveLength(1);
      const entry = report.entries[0];
      expect(entry.promptTokens).toBe(3000);
      expect(entry.completionTokens).toBe(1500);
      // promptCost = 3000 * 0.5 / 1000 = 1.5
      expect(entry.promptCost).toBeCloseTo(1.5);
      // completionCost = 1500 * 1.0 / 1000 = 1.5
      expect(entry.completionCost).toBeCloseTo(1.5);
      expect(entry.totalCost).toBeCloseTo(3.0);
      expect(report.totalCost).toBeCloseTo(3.0);
    });

    it('should handle multiple users and providers', () => {
      insertUsage('u1', 'kimi', 'k1', 1000, 500, '2024-01-15 10:00:00');
      insertUsage('u2', 'glm', 'k2', 2000, 1000, '2024-01-15 10:00:00');

      const report = calculator.generateReport(JAN_RANGE);

      expect(report.entries).toHaveLength(2);

      const u1Entry = report.entries.find(e => e.userId === 'u1' && e.provider === 'kimi')!;
      expect(u1Entry.promptCost).toBeCloseTo(0.5);   // 1000 * 0.5 / 1000
      expect(u1Entry.completionCost).toBeCloseTo(0.5); // 500 * 1.0 / 1000
      expect(u1Entry.totalCost).toBeCloseTo(1.0);

      const u2Entry = report.entries.find(e => e.userId === 'u2' && e.provider === 'glm')!;
      expect(u2Entry.promptCost).toBeCloseTo(0.6);   // 2000 * 0.3 / 1000
      expect(u2Entry.completionCost).toBeCloseTo(0.6); // 1000 * 0.6 / 1000
      expect(u2Entry.totalCost).toBeCloseTo(1.2);

      expect(report.totalCost).toBeCloseTo(2.2);
    });

    it('should only include usage within the specified time range', () => {
      insertUsage('u1', 'kimi', 'k1', 1000, 500, '2024-01-15 10:00:00');
      insertUsage('u1', 'kimi', 'k1', 2000, 1000, '2024-02-15 10:00:00'); // outside range

      const report = calculator.generateReport(JAN_RANGE);

      expect(report.entries).toHaveLength(1);
      expect(report.entries[0].promptTokens).toBe(1000);
    });

    it('should handle zero pricing gracefully', () => {
      // Add a provider with zero pricing
      const db = getDatabase();
      db.exec(`
        INSERT OR IGNORE INTO providers (id, name, api_base_url, prompt_price_per_k_token, completion_price_per_k_token)
        VALUES ('free', 'Free', 'https://free.example.com', 0, 0)
      `);
      db.exec(`
        INSERT OR IGNORE INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id)
        VALUES ('k3', 'free', 'enc', 'iv', 'tag', 'u1')
      `);
      insertUsage('u1', 'free', 'k3', 5000, 3000, '2024-01-15 10:00:00');

      const report = calculator.generateReport(JAN_RANGE);

      expect(report.entries).toHaveLength(1);
      expect(report.entries[0].promptCost).toBe(0);
      expect(report.entries[0].completionCost).toBe(0);
      expect(report.entries[0].totalCost).toBe(0);
      expect(report.totalCost).toBe(0);
    });

    it('should sum totalCost across all entries', () => {
      // u1 uses kimi, u1 also uses glm
      insertUsage('u1', 'kimi', 'k1', 1000, 1000, '2024-01-15 10:00:00');
      insertUsage('u1', 'glm', 'k2', 1000, 1000, '2024-01-15 10:00:00');

      const report = calculator.generateReport(JAN_RANGE);

      expect(report.entries).toHaveLength(2);
      // kimi: 1000*0.5/1000 + 1000*1.0/1000 = 0.5 + 1.0 = 1.5
      // glm:  1000*0.3/1000 + 1000*0.6/1000 = 0.3 + 0.6 = 0.9
      expect(report.totalCost).toBeCloseTo(2.4);
    });
  });
});
