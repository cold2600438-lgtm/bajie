// ============================================================
// Authentication Middleware: Token validation and role-based access
// ============================================================

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/database.js';
import type { UserInfo } from '../types/index.js';

// Augment FastifyRequest to include authenticated user info
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserInfo;
  }
}

/**
 * 从请求中提取访问 Token。
 * 支持两种方式：
 *   1. Authorization: Bearer <token>
 *   2. x-api-key: <token>
 */
function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return apiKey;
  }

  return null;
}

/**
 * 根据 access_token 查询数据库，返回 UserInfo 或 null。
 */
function lookupUser(token: string): UserInfo | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT id, username, access_token, role, status, allowed_providers, created_at, updated_at FROM users WHERE access_token = ?',
  ).get(token) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id as string,
    username: row.username as string,
    accessToken: row.access_token as string,
    role: row.role as 'user' | 'admin',
    status: row.status as 'active' | 'disabled',
    allowedProviders: row.allowed_providers ? JSON.parse(row.allowed_providers as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}


/**
 * 认证中间件（用户端点）。
 * 验证请求携带的 Token 是否有效且用户状态为 active。
 * 通过后将 UserInfo 挂载到 request.user。
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing access token' });
  }

  const user = lookupUser(token);
  if (!user) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid access token' });
  }

  if (user.status === 'disabled') {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Account is disabled' });
  }

  request.user = user;
}

/**
 * 管理员认证中间件（管理端点）。
 * 支持两种认证方式：
 *   1. 使用环境变量中的 ADMIN_TOKEN 直接认证
 *   2. 使用普通用户 Token 认证，但要求 role='admin'
 */
export async function adminMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing access token' });
  }

  // Check against the static ADMIN_TOKEN from config
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && token === adminToken) {
    // Admin token matched — no user record needed
    request.user = {
      id: 'admin',
      username: 'admin',
      accessToken: token,
      role: 'admin',
      status: 'active',
      allowedProviders: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return;
  }

  // Fall back to database user lookup
  const user = lookupUser(token);
  if (!user) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid access token' });
  }

  if (user.status === 'disabled') {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Account is disabled' });
  }

  if (user.role !== 'admin') {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Admin access required' });
  }

  request.user = user;
}
