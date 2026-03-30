import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { userRoutes } from './user.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-user-handler-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

function seedProvider(providerId: string, baseUrl: string) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES (?, ?, ?)`,
  ).run(providerId, providerId, baseUrl);
}

// Mock the KeyValidator to avoid real HTTP calls
vi.mock('../services/key-validator.js', () => {
  return {
    KeyValidator: vi.fn().mockImplementation(() => ({
      validateKey: vi.fn().mockResolvedValue(true),
    })),
  };
});

describe('User Register Endpoint', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    seedProvider('minimax', 'https://api.minimaxi.com/anthropic');
  });

  afterEach(() => {
    cleanup(dbPath);
    delete process.env.ENCRYPTION_KEY;
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(userRoutes);
    return app;
  }

  describe('POST /api/user/register (basic)', () => {
    it('should register a user and return 201', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: { username: 'alice' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.userId).toBeDefined();
      expect(body.accessToken).toBeDefined();
      expect(body.apiKeyValid).toBeUndefined();
    });

    it('should return 400 for missing username', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 409 for duplicate username', async () => {
      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: { username: 'bob' },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: { username: 'bob' },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /api/user/register (with API key)', () => {
    it('should register with valid API key and return apiKeyValid: true', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: {
          username: 'charlie',
          apiKey: 'sk-valid-key',
          apiKeyProvider: 'minimax',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.userId).toBeDefined();
      expect(body.accessToken).toBeDefined();
      expect(body.apiKeyValid).toBe(true);

      // Verify key was added to the pool
      const db = getDatabase();
      const row = db.prepare(
        'SELECT * FROM api_keys WHERE contributor_user_id = ?',
      ).get(body.userId) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.provider_id).toBe('minimax');
    });

    it('should return apiKeyValid: false for non-existent provider', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: {
          username: 'dave',
          apiKey: 'sk-some-key',
          apiKeyProvider: 'nonexistent-provider',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.apiKeyValid).toBe(false);
    });

    it('should still register user even if only apiKey is provided without apiKeyProvider', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/user/register',
        payload: {
          username: 'eve',
          apiKey: 'sk-orphan-key',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.userId).toBeDefined();
      // No apiKeyValid since apiKeyProvider was not provided
      expect(body.apiKeyValid).toBeUndefined();
    });
  });
});


describe('User Reset Token Endpoint', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  function createUserAndGetToken(): { userId: string; token: string } {
    const db = getDatabase();
    const token = randomBytes(32).toString('hex');
    const userId = 'user-reset-1';
    db.prepare(
      `INSERT INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, 'user', 'active')`,
    ).run(userId, 'reset-tester', token);
    return { userId, token };
  }

  async function buildApp() {
    const app = Fastify();
    await app.register(userRoutes);
    return app;
  }

  it('should reset token and return new one', async () => {
    const { token } = createUserAndGetToken();
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/user/reset-token',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.accessToken).not.toBe(token);
    expect(body.accessToken.length).toBe(64);
  });

  it('should return 401 without auth token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/user/reset-token',
    });
    expect(res.statusCode).toBe(401);
  });
});


describe('User Profile Endpoint', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  function createUserAndGetToken(): string {
    const db = getDatabase();
    const token = randomBytes(32).toString('hex');
    db.prepare(
      `INSERT INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, 'user', 'active')`,
    ).run('user-profile-1', 'profile-tester', token);
    return token;
  }

  async function buildApp() {
    const app = Fastify();
    await app.register(userRoutes);
    return app;
  }

  it('should return current user profile', async () => {
    const token = createUserAndGetToken();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('user-profile-1');
    expect(body.username).toBe('profile-tester');
    expect(body.role).toBe('user');
    expect(body.status).toBe('active');
    expect(body.allowedProviders).toBeNull();
  });

  it('should return 401 without auth token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/profile',
    });
    expect(res.statusCode).toBe(401);
  });
});


describe('User Usage Endpoint', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    seedProvider('minimax', 'https://api.minimaxi.com/anthropic');
  });

  afterEach(() => {
    cleanup(dbPath);
    delete process.env.ENCRYPTION_KEY;
  });

  function createUserAndGetToken(): string {
    const db = getDatabase();
    const token = randomBytes(32).toString('hex');
    db.prepare(
      `INSERT INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, 'user', 'active')`,
    ).run('user-usage-1', 'usage-tester', token);
    return token;
  }

  function seedUsageData(userId: string) {
    const db = getDatabase();
    // Need an api_key row for foreign key
    db.prepare(
      `INSERT INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    ).run('key-1', 'minimax', 'enc', 'iv', 'tag', userId);

    db.prepare(
      `INSERT INTO token_usage (user_id, provider_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, 'minimax', 'key-1', 'test-model', 100, 50, 150, '2024-01-15 10:00:00');

    db.prepare(
      `INSERT INTO token_usage (user_id, provider_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, 'minimax', 'key-1', 'test-model', 200, 100, 300, '2024-01-15 11:00:00');
  }

  async function buildApp() {
    const app = Fastify();
    await app.register(userRoutes);
    return app;
  }

  it('should return 401 without auth token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/usage?start=2024-01-01&end=2024-12-31',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return 400 when start/end are missing', async () => {
    const token = createUserAndGetToken();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/usage',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return 400 for invalid date strings', async () => {
    const token = createUserAndGetToken();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/usage?start=not-a-date&end=also-not',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return usage data for authenticated user', async () => {
    const token = createUserAndGetToken();
    seedUsageData('user-usage-1');
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/usage?start=2024-01-01&end=2024-12-31',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].userId).toBe('user-usage-1');
    expect(body[0].promptTokens).toBe(300);
    expect(body[0].completionTokens).toBe(150);
  });

  it('should default granularity to day', async () => {
    const token = createUserAndGetToken();
    seedUsageData('user-usage-1');
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/usage?start=2024-01-01&end=2024-12-31',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // day granularity: period should be a date string like "2024-01-15"
    expect(body[0].period).toBe('2024-01-15');
  });

  it('should support month granularity', async () => {
    const token = createUserAndGetToken();
    seedUsageData('user-usage-1');
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/user/usage?start=2024-01-01&end=2024-12-31&granularity=month',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].period).toBe('2024-01');
  });
});
