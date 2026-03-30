import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { maskApiKey, requestLoggerPlugin } from './request-logger.js';
import Fastify from 'fastify';

describe('maskApiKey', () => {
  it('masks a long key showing only last 4 characters', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe('****mnop');
  });

  it('masks a short key (<=4 chars) entirely', () => {
    expect(maskApiKey('abcd')).toBe('****');
    expect(maskApiKey('ab')).toBe('****');
  });

  it('masks a 5-character key correctly', () => {
    expect(maskApiKey('12345')).toBe('****2345');
  });
});

describe('requestLoggerPlugin', () => {
  beforeEach(() => {
    initializeDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('logs a request to the request_logs table', async () => {
    const app = Fastify();
    await app.register(requestLoggerPlugin);

    app.get('/test', async (_req, reply) => {
      return reply.code(200).send({ ok: true });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);

    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM request_logs').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe('GET');
    expect(rows[0].path).toBe('/test');
    expect(rows[0].status_code).toBe(200);
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].provider_id).toBeNull();
  });

  it('captures user_id from request.user', async () => {
    const app = Fastify();
    await app.register(requestLoggerPlugin);

    // Simulate auth middleware setting request.user
    app.addHook('onRequest', async (request) => {
      (request as unknown as Record<string, unknown>).user = { id: 'user-123' };
    });

    app.get('/authed', async (_req, reply) => {
      return reply.code(200).send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/authed' });

    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM request_logs').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('user-123');
  });

  it('captures provider_id from X-Provider response header', async () => {
    const app = Fastify();
    await app.register(requestLoggerPlugin);

    app.get('/with-provider', async (_req, reply) => {
      reply.header('X-Provider', 'kimi');
      return reply.code(200).send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/with-provider' });

    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM request_logs').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_id).toBe('kimi');
  });

  it('records duration_ms as a positive number', async () => {
    const app = Fastify();
    await app.register(requestLoggerPlugin);

    app.get('/slow', async (_req, reply) => {
      // Small delay to ensure measurable duration
      await new Promise((resolve) => setTimeout(resolve, 10));
      return reply.code(200).send({ ok: true });
    });

    await app.inject({ method: 'GET', url: '/slow' });

    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM request_logs').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('logs non-200 status codes correctly', async () => {
    const app = Fastify();
    await app.register(requestLoggerPlugin);

    app.get('/not-found', async (_req, reply) => {
      return reply.code(404).send({ error: 'Not found' });
    });

    await app.inject({ method: 'GET', url: '/not-found' });

    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM request_logs').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status_code).toBe(404);
  });
});
