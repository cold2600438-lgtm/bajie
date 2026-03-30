import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { adminRoutes } from './admin.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ADMIN_TOKEN = 'test-admin-token-12345';
const ENCRYPTION_KEY = randomBytes(32).toString('hex');

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-admin-handler-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

function seedProvider(providerId: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES (?, ?, ?)`,
  ).run(providerId, providerId, `https://${providerId}.example.com`);
}

function seedUser(userId: string, username: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, 'user', 'active')`,
  ).run(userId, username, randomBytes(32).toString('hex'));
}

describe('Admin Key Management Endpoints', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    seedProvider('minimax');
    seedUser('user-1', 'contributor-user');
  });

  afterEach(() => {
    cleanup(dbPath);
    delete process.env.ADMIN_TOKEN;
    delete process.env.ENCRYPTION_KEY;
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(adminRoutes);
    return app;
  }

  // --- POST /api/admin/keys ---

  describe('POST /api/admin/keys', () => {
    it('should add a key and return 201', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-test-key-123',
          contributorUserId: 'user-1',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.provider).toBe('minimax');
      expect(body.contributorUserId).toBe('user-1');
      expect(body.status).toBe('active');
    });

    it('should add a key with estimatedQuota', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-test-key-456',
          contributorUserId: 'user-1',
          estimatedQuota: 10000,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().estimatedQuota).toBe(10000);
    });

    it('should return 400 when provider is missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { key: 'sk-test', contributorUserId: 'user-1' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 when key is missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { provider: 'minimax', contributorUserId: 'user-1' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 when contributorUserId is missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { provider: 'minimax', key: 'sk-test' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 when provider does not exist', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'nonexistent-provider',
          key: 'sk-test',
          contributorUserId: 'user-1',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain('Provider not found');
    });

    it('should return 401 without admin token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        payload: {
          provider: 'minimax',
          key: 'sk-test',
          contributorUserId: 'user-1',
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- DELETE /api/admin/keys/:id ---

  describe('DELETE /api/admin/keys/:id', () => {
    it('should remove a key and return 200', async () => {
      const app = await buildApp();
      // First add a key
      const addRes = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-to-delete',
          contributorUserId: 'user-1',
        },
      });
      const keyId = addRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/keys/${keyId}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe('API key removed');
    });

    it('should return 404 for non-existent key', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/keys/nonexistent-id',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // --- PUT /api/admin/keys/:id ---

  describe('PUT /api/admin/keys/:id', () => {
    it('should update key status', async () => {
      const app = await buildApp();
      const addRes = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-to-update',
          contributorUserId: 'user-1',
        },
      });
      const keyId = addRes.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/keys/${keyId}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { status: 'disabled' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe('API key updated');

      // Verify in DB
      const db = getDatabase();
      const row = db.prepare('SELECT status FROM api_keys WHERE id = ?').get(keyId) as Record<string, unknown>;
      expect(row.status).toBe('disabled');
    });

    it('should update estimatedQuota', async () => {
      const app = await buildApp();
      const addRes = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-quota',
          contributorUserId: 'user-1',
        },
      });
      const keyId = addRes.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/keys/${keyId}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { estimatedQuota: 50000 },
      });
      expect(res.statusCode).toBe(200);

      const db = getDatabase();
      const row = db.prepare('SELECT estimated_quota FROM api_keys WHERE id = ?').get(keyId) as Record<string, unknown>;
      expect(row.estimated_quota).toBe(50000);
    });

    it('should return 400 when no fields provided', async () => {
      const app = await buildApp();
      const addRes = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-noop',
          contributorUserId: 'user-1',
        },
      });
      const keyId = addRes.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/keys/${keyId}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid status', async () => {
      const app = await buildApp();
      const addRes = await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-bad-status',
          contributorUserId: 'user-1',
        },
      });
      const keyId = addRes.json().id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/keys/${keyId}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { status: 'invalid-status' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for non-existent key', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/keys/nonexistent-id',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { status: 'disabled' },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});


describe('Admin Usage & Cost Endpoints', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    seedProvider('minimax');
    seedUser('user-1', 'contributor-user');
  });

  afterEach(() => {
    cleanup(dbPath);
    delete process.env.ADMIN_TOKEN;
    delete process.env.ENCRYPTION_KEY;
  });

  function seedUsageData() {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    ).run('key-1', 'minimax', 'enc', 'iv', 'tag', 'user-1');

    db.prepare(
      `INSERT INTO token_usage (user_id, provider_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('user-1', 'minimax', 'key-1', 'test-model', 500, 200, 700, '2024-01-15 10:00:00');
  }

  async function buildApp() {
    const app = Fastify();
    await app.register(adminRoutes);
    return app;
  }

  // --- GET /api/admin/usage ---

  describe('GET /api/admin/usage', () => {
    it('should return all usage data', async () => {
      seedUsageData();
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/usage?start=2024-01-01&end=2024-12-31',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0].userId).toBe('user-1');
    });

    it('should return 400 when start/end missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/usage',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid dates', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/usage?start=bad&end=bad',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 401 without admin token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/usage?start=2024-01-01&end=2024-12-31',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- PUT /api/admin/providers/:id/pricing ---

  describe('PUT /api/admin/providers/:id/pricing', () => {
    it('should update provider pricing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/providers/minimax/pricing',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { promptPricePerKToken: 0.5, completionPricePerKToken: 1.0 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe('Provider pricing updated');

      // Verify in DB
      const db = getDatabase();
      const row = db.prepare('SELECT prompt_price_per_k_token, completion_price_per_k_token FROM providers WHERE id = ?').get('minimax') as Record<string, unknown>;
      expect(row.prompt_price_per_k_token).toBe(0.5);
      expect(row.completion_price_per_k_token).toBe(1.0);
    });

    it('should update only promptPricePerKToken', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/providers/minimax/pricing',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { promptPricePerKToken: 0.3 },
      });
      expect(res.statusCode).toBe(200);
    });

    it('should return 400 when no pricing fields provided', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/providers/minimax/pricing',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 404 for non-existent provider', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/providers/nonexistent/pricing',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { promptPricePerKToken: 0.5 },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // --- POST /api/admin/reports/cost ---

  describe('POST /api/admin/reports/cost', () => {
    it('should generate a cost report', async () => {
      seedUsageData();
      // Set pricing first
      const db = getDatabase();
      db.prepare('UPDATE providers SET prompt_price_per_k_token = 0.5, completion_price_per_k_token = 1.0 WHERE id = ?').run('minimax');

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reports/cost',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { start: '2024-01-01', end: '2024-12-31' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries).toBeDefined();
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.totalCost).toBeGreaterThan(0);
      expect(body.entries[0].userId).toBe('user-1');
      expect(body.entries[0].provider).toBe('minimax');
    });

    it('should return 400 when start/end missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reports/cost',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid dates', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/reports/cost',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { start: 'invalid', end: 'invalid' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});


describe('Admin New Endpoints (users list, reset-token, keys list, providers list)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    seedProvider('minimax');
    seedUser('user-1', 'contributor-user');
  });

  afterEach(() => {
    cleanup(dbPath);
    delete process.env.ADMIN_TOKEN;
    delete process.env.ENCRYPTION_KEY;
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(adminRoutes);
    return app;
  }

  // --- POST /api/admin/users/:id/reset-token ---

  describe('POST /api/admin/users/:id/reset-token', () => {
    it('should reset user token and return new one', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/user-1/reset-token',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken).toBeDefined();
      expect(body.accessToken.length).toBe(64);
    });

    it('should return 404 for non-existent user', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/nonexistent/reset-token',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without admin token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/users/user-1/reset-token',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- GET /api/admin/users ---

  describe('GET /api/admin/users', () => {
    it('should return all users', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].username).toBe('contributor-user');
    });

    it('should return 401 without admin token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- GET /api/admin/keys ---

  describe('GET /api/admin/keys', () => {
    it('should return empty list when no keys exist', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('should return keys with masked encrypted_key', async () => {
      // Add a key first
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          provider: 'minimax',
          key: 'sk-test-key-for-listing',
          contributorUserId: 'user-1',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBe(1);
      expect(body[0].provider).toBe('minimax');
      expect(body[0].maskedKey).toMatch(/^\*\*\*\*.{4}$/);
      expect(body[0].contributorUsername).toBe('contributor-user');
    });

    it('should return 401 without admin token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/keys',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- GET /api/admin/providers ---

  describe('GET /api/admin/providers', () => {
    it('should return all providers', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/providers',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].id).toBe('minimax');
      expect(body[0].name).toBe('minimax');
      expect(body[0].apiBaseUrl).toBeDefined();
      expect(typeof body[0].isDefault).toBe('boolean');
    });

    it('should return 401 without admin token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/providers',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
