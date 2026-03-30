import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';

// Helper to create a mock FastifyRequest
function mockRequest(headers: Record<string, string> = {}): FastifyRequest {
  return { headers, user: undefined } as unknown as FastifyRequest;
}

// Helper to create a mock FastifyReply that captures the response
function mockReply() {
  let statusCode = 200;
  let body: unknown = undefined;
  const reply = {
    code(code: number) {
      statusCode = code;
      return reply;
    },
    send(data: unknown) {
      body = data;
      return reply;
    },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
  return reply as unknown as FastifyReply & { statusCode: number; body: unknown };
}

describe('auth middleware', () => {
  beforeEach(() => {
    initializeDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
  });

  function insertUser(overrides: Partial<{ id: string; username: string; access_token: string; role: string; status: string }> = {}) {
    const db = getDatabase();
    const id = overrides.id ?? randomUUID();
    const username = overrides.username ?? `user-${id.slice(0, 8)}`;
    const accessToken = overrides.access_token ?? randomUUID();
    const role = overrides.role ?? 'user';
    const status = overrides.status ?? 'active';
    db.prepare(
      'INSERT INTO users (id, username, access_token, role, status) VALUES (?, ?, ?, ?, ?)',
    ).run(id, username, accessToken, role, status);
    return { id, username, accessToken, role, status };
  }

  describe('authMiddleware', () => {
    it('returns 401 when no token is provided', async () => {
      const req = mockRequest();
      const reply = mockReply();
      await authMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
      expect((reply.body as { message: string }).message).toBe('Missing access token');
    });

    it('returns 401 for an invalid token', async () => {
      const req = mockRequest({ authorization: 'Bearer invalid-token' });
      const reply = mockReply();
      await authMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
      expect((reply.body as { message: string }).message).toBe('Invalid access token');
    });

    it('returns 401 for a disabled user', async () => {
      const user = insertUser({ status: 'disabled' });
      const req = mockRequest({ authorization: `Bearer ${user.accessToken}` });
      const reply = mockReply();
      await authMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
      expect((reply.body as { message: string }).message).toBe('Account is disabled');
    });

    it('authenticates a valid active user via Authorization header', async () => {
      const user = insertUser();
      const req = mockRequest({ authorization: `Bearer ${user.accessToken}` });
      const reply = mockReply();
      await authMiddleware(req, reply);
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe(user.id);
      expect(req.user!.role).toBe('user');
      expect(req.user!.status).toBe('active');
    });

    it('authenticates a valid active user via x-api-key header', async () => {
      const user = insertUser();
      const req = mockRequest({ 'x-api-key': user.accessToken });
      const reply = mockReply();
      await authMiddleware(req, reply);
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe(user.id);
    });

    it('parses allowed_providers JSON correctly', async () => {
      const db = getDatabase();
      const id = randomUUID();
      const token = randomUUID();
      db.prepare(
        "INSERT INTO users (id, username, access_token, role, status, allowed_providers) VALUES (?, ?, ?, 'user', 'active', ?)",
      ).run(id, `user-${id.slice(0, 8)}`, token, JSON.stringify(['kimi', 'minimax']));

      const req = mockRequest({ authorization: `Bearer ${token}` });
      const reply = mockReply();
      await authMiddleware(req, reply);
      expect(req.user!.allowedProviders).toEqual(['kimi', 'minimax']);
    });
  });

  describe('adminMiddleware', () => {
    it('returns 401 when no token is provided', async () => {
      const req = mockRequest();
      const reply = mockReply();
      await adminMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
    });

    it('authenticates with ADMIN_TOKEN from env', async () => {
      const adminToken = 'super-secret-admin-token';
      process.env.ADMIN_TOKEN = adminToken;
      try {
        const req = mockRequest({ authorization: `Bearer ${adminToken}` });
        const reply = mockReply();
        await adminMiddleware(req, reply);
        expect(req.user).toBeDefined();
        expect(req.user!.role).toBe('admin');
        expect(req.user!.id).toBe('admin');
      } finally {
        delete process.env.ADMIN_TOKEN;
      }
    });

    it('authenticates a database user with admin role', async () => {
      const user = insertUser({ role: 'admin' });
      const req = mockRequest({ authorization: `Bearer ${user.accessToken}` });
      const reply = mockReply();
      await adminMiddleware(req, reply);
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe(user.id);
      expect(req.user!.role).toBe('admin');
    });

    it('rejects a regular user on admin endpoint', async () => {
      const user = insertUser({ role: 'user' });
      const req = mockRequest({ authorization: `Bearer ${user.accessToken}` });
      const reply = mockReply();
      await adminMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
      expect((reply.body as { message: string }).message).toBe('Admin access required');
    });

    it('rejects a disabled admin user', async () => {
      const user = insertUser({ role: 'admin', status: 'disabled' });
      const req = mockRequest({ authorization: `Bearer ${user.accessToken}` });
      const reply = mockReply();
      await adminMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
      expect((reply.body as { message: string }).message).toBe('Account is disabled');
    });

    it('rejects an invalid token', async () => {
      const req = mockRequest({ authorization: 'Bearer totally-wrong' });
      const reply = mockReply();
      await adminMiddleware(req, reply);
      expect(reply.statusCode).toBe(401);
      expect((reply.body as { message: string }).message).toBe('Invalid access token');
    });
  });
});
