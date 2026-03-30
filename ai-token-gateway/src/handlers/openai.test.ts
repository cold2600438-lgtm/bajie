import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { openaiRoutes } from './openai.js';
import { randomBytes } from 'node:crypto';
import { encrypt } from '../services/crypto.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock undici to avoid real HTTP calls
vi.mock('undici', () => ({
  request: vi.fn(),
}));

import { request as undiciRequest } from 'undici';
const mockUndiciRequest = vi.mocked(undiciRequest);

const ADMIN_TOKEN = 'test-admin-token-12345';
const ENCRYPTION_KEY = randomBytes(32).toString('hex');
const USER_TOKEN = 'user-access-token-abc';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-openai-handler-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

function seedProvider(providerId: string, isDefault = false) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO providers (id, name, api_base_url, is_default) VALUES (?, ?, ?, ?)`,
  ).run(providerId, providerId, `https://${providerId}.example.com`, isDefault ? 1 : 0);
}

function seedUser(userId: string, username: string, token: string, allowedProviders: string[] | null = null) {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, access_token, role, status, allowed_providers) VALUES (?, ?, ?, 'user', 'active', ?)`,
  ).run(userId, username, token, allowedProviders ? JSON.stringify(allowedProviders) : null);
}

function seedApiKey(providerId: string, contributorUserId: string): string {
  const db = getDatabase();
  const keyId = `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const encData = encrypt('sk-test-real-key', ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id, status, consecutive_failures)
     VALUES (?, ?, ?, ?, ?, ?, 'active', 0)`,
  ).run(keyId, providerId, encData.encrypted, encData.iv, encData.tag, contributorUserId, );
  return keyId;
}

describe('OpenAI Routes', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    seedProvider('minimax', true);
    seedUser('user-1', 'testuser', USER_TOKEN);
    seedApiKey('minimax', 'user-1');
    mockUndiciRequest.mockReset();
  });

  afterEach(() => {
    cleanup(dbPath);
    delete process.env.ADMIN_TOKEN;
    delete process.env.ENCRYPTION_KEY;
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(openaiRoutes);
    return app;
  }

  // --- Authentication ---

  describe('Authentication', () => {
    it('should return 401 without auth token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: 'Bearer invalid-token' },
        payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('should return 401 for GET /openai/v1/models without auth', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/openai/v1/models',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- Request Validation ---

  describe('Request Validation', () => {
    it('should return 400 when model is missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('model');
    });

    it('should return 400 when messages is missing', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: { model: 'gpt-4' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('messages');
    });
  });

  // --- Non-Streaming Proxy ---

  describe('Non-Streaming Chat Completions', () => {
    it('should proxy request and return response with headers', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, index: 0 }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      mockUndiciRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { json: async () => mockResponse },
      } as any);

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage.prompt_tokens).toBe(10);
      expect(body.usage.completion_tokens).toBe(5);
      expect(res.headers['x-provider']).toBe('minimax');
      expect(res.headers['x-key-id']).toBeDefined();
    });

    it('should record usage in the database', async () => {
      const mockResponse = {
        id: 'chatcmpl-456',
        choices: [{ message: { role: 'assistant', content: 'Hi' } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      };

      mockUndiciRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { json: async () => mockResponse },
      } as any);

      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      const db = getDatabase();
      const row = db.prepare(
        'SELECT * FROM token_usage WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      ).get('user-1') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.prompt_tokens).toBe(20);
      expect(row.completion_tokens).toBe(10);
      expect(row.total_tokens).toBe(30);
      expect(row.model).toBe('test-model');
    });

    it('should forward upstream errors', async () => {
      mockUndiciRequest.mockResolvedValueOnce({
        statusCode: 500,
        headers: {},
        body: { json: async () => ({ error: { message: 'Internal error' } }) },
      } as any);

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(500);
    });

    it('should mark key failure on 429 response', async () => {
      mockUndiciRequest.mockResolvedValueOnce({
        statusCode: 429,
        headers: {},
        body: { json: async () => ({ error: { message: 'Rate limited' } }) },
      } as any);

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(429);
    });

    it('should return 502 on network error', async () => {
      mockUndiciRequest.mockRejectedValueOnce(new Error('Connection refused'));

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().message).toContain('Connection refused');
    });

    it('should pass through tools and max_tokens', async () => {
      const mockResponse = {
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      };

      mockUndiciRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { json: async () => mockResponse },
      } as any);

      const app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
          tools: [{ type: 'function', function: { name: 'test' } }],
          max_tokens: 100,
        },
      });

      // Verify the upstream request included tools and max_tokens
      expect(mockUndiciRequest).toHaveBeenCalledTimes(1);
      const callArgs = mockUndiciRequest.mock.calls[0];
      const sentBody = JSON.parse(callArgs[1]!.body as string);
      expect(sentBody.tools).toBeDefined();
      expect(sentBody.max_tokens).toBe(100);
    });
  });

  // --- Provider Access ---

  describe('Provider Access Control', () => {
    it('should return 403 when user has restricted providers', async () => {
      // Create a user with restricted provider access
      seedUser('user-restricted', 'restricted', 'restricted-token', ['other-provider']);

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: 'Bearer restricted-token' },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('not allowed');
    });
  });

  // --- No Provider / No Keys ---

  describe('Service Unavailable', () => {
    it('should return 503 when no provider is configured', async () => {
      // Remove all providers
      const db = getDatabase();
      db.prepare('DELETE FROM api_keys').run();
      db.prepare('DELETE FROM providers').run();

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('No provider');
    });

    it('should return 503 when no API keys available', async () => {
      // Remove all keys
      const db = getDatabase();
      db.prepare('DELETE FROM api_keys').run();

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('No available API keys');
    });
  });

  // --- GET /openai/v1/models ---

  describe('GET /openai/v1/models', () => {
    it('should proxy models listing', async () => {
      const mockModels = {
        object: 'list',
        data: [{ id: 'gpt-4', object: 'model' }],
      };

      mockUndiciRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: { json: async () => mockModels },
      } as any);

      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/openai/v1/models',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.headers['x-provider']).toBe('minimax');
    });

    it('should return 502 on upstream error', async () => {
      mockUndiciRequest.mockRejectedValueOnce(new Error('Timeout'));

      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/openai/v1/models',
        headers: { authorization: `Bearer ${USER_TOKEN}` },
      });

      expect(res.statusCode).toBe(502);
    });
  });
});
