// ============================================================
// Admin Routes: User management + Key management endpoints (admin-only)
// ============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/auth.js';
import { UserManager } from '../services/user-manager.js';
import { KeyPoolManager } from '../services/key-pool.js';
import { UsageTracker } from '../services/usage-tracker.js';
import { CostCalculator } from '../services/cost-calculator.js';
import { getDatabase } from '../db/database.js';

const userManager = new UserManager();
const keyPoolManager = new KeyPoolManager();
const usageTracker = new UsageTracker();
const costCalculator = new CostCalculator();

/**
 * Fastify plugin that registers admin user-management routes.
 * All routes require admin authentication via adminMiddleware.
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply admin auth to every route in this plugin
  fastify.addHook('onRequest', adminMiddleware);

  // POST /api/admin/users — create a new user
  fastify.post(
    '/api/admin/users',
    async (
      request: FastifyRequest<{
        Body: { username: string; role?: 'user' | 'admin'; allowedProviders?: string[] };
      }>,
      reply: FastifyReply,
    ) => {
      const { username, role, allowedProviders } = request.body ?? {};

      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'username is required and must be a non-empty string',
        });
      }

      try {
        const user = userManager.createUser({
          username: username.trim(),
          role,
          allowedProviders,
        });
        return reply.code(201).send(user);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          return reply.code(409).send({
            error: 'Conflict',
            message: `Username '${username.trim()}' is already taken`,
          });
        }
        throw err;
      }
    },
  );

  // PUT /api/admin/users/:id/disable — disable a user
  fastify.put(
    '/api/admin/users/:id/disable',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      try {
        userManager.disableUser(id);
        return reply.code(200).send({ message: 'User disabled' });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('User not found')) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `User not found: ${id}`,
          });
        }
        throw err;
      }
    },
  );

  // DELETE /api/admin/users/:id — delete a user
  fastify.delete(
    '/api/admin/users/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      try {
        userManager.deleteUser(id);
        return reply.code(200).send({ message: 'User deleted' });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('User not found')) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `User not found: ${id}`,
          });
        }
        throw err;
      }
    },
  );

  // PUT /api/admin/users/:id/providers — configure provider access
  fastify.put(
    '/api/admin/users/:id/providers',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { providers: string[] };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const { providers } = request.body ?? {};

      if (!Array.isArray(providers)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'providers must be an array of strings',
        });
      }

      try {
        userManager.setUserProviders(id, providers);
        return reply.code(200).send({ message: 'Providers updated', providers });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('User not found')) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `User not found: ${id}`,
          });
        }
        throw err;
      }
    },
  );

  // ============================================================
  // Key Management Endpoints
  // ============================================================

  // POST /api/admin/keys — add a new API key to the pool
  fastify.post(
    '/api/admin/keys',
    async (
      request: FastifyRequest<{
        Body: {
          provider: string;
          key: string;
          contributorUserId: string;
          estimatedQuota?: number;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { provider, key, contributorUserId, estimatedQuota } = request.body ?? {};

      if (!provider || typeof provider !== 'string') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'provider is required and must be a string',
        });
      }
      if (!key || typeof key !== 'string') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'key is required and must be a string',
        });
      }
      if (!contributorUserId || typeof contributorUserId !== 'string') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'contributorUserId is required and must be a string',
        });
      }

      // Verify the provider exists in the providers table
      const db = getDatabase();
      const providerRow = db.prepare('SELECT id FROM providers WHERE id = ?').get(provider);
      if (!providerRow) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Provider not found: ${provider}`,
        });
      }

      const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
      const entry = keyPoolManager.addKey(
        { provider, key, contributorUserId, estimatedQuota },
        encryptionKey,
      );

      return reply.code(201).send({
        id: entry.id,
        provider: entry.provider,
        contributorUserId: entry.contributorUserId,
        status: entry.status,
        estimatedQuota: entry.estimatedQuota,
        createdAt: entry.createdAt.toISOString(),
      });
    },
  );

  // DELETE /api/admin/keys/:id — remove an API key
  fastify.delete(
    '/api/admin/keys/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      try {
        keyPoolManager.removeKey(id);
        return reply.code(200).send({ message: 'API key removed' });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('API key not found')) {
          return reply.code(404).send({
            error: 'Not Found',
            message: `API key not found: ${id}`,
          });
        }
        throw err;
      }
    },
  );

  // PUT /api/admin/keys/:id — update an API key (status, estimatedQuota)
  fastify.put(
    '/api/admin/keys/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status?: 'active' | 'disabled' | 'exhausted'; estimatedQuota?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const { status, estimatedQuota } = request.body ?? {};

      if (status === undefined && estimatedQuota === undefined) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'At least one of status or estimatedQuota must be provided',
        });
      }

      if (status !== undefined && !['active', 'disabled', 'exhausted'].includes(status)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: "status must be one of: 'active', 'disabled', 'exhausted'",
        });
      }

      const db = getDatabase();

      // Check the key exists
      const existing = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id);
      if (!existing) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `API key not found: ${id}`,
        });
      }

      // Build dynamic update
      const updates: string[] = [];
      const values: unknown[] = [];

      if (status !== undefined) {
        updates.push('status = ?');
        values.push(status);
      }
      if (estimatedQuota !== undefined) {
        updates.push('estimated_quota = ?');
        values.push(estimatedQuota);
      }

      values.push(id);
      db.prepare(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return reply.code(200).send({ message: 'API key updated' });
    },
  );

  // ============================================================
  // Usage & Cost Endpoints
  // ============================================================

  // GET /api/admin/usage — query all users' usage
  fastify.get(
    '/api/admin/usage',
    async (
      request: FastifyRequest<{
        Querystring: { start?: string; end?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { start, end } = request.query;

      if (!start || !end) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'start and end query parameters are required (ISO date strings)',
        });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'start and end must be valid ISO date strings',
        });
      }

      const usage = usageTracker.getAllUsage({ start: startDate, end: endDate });
      return reply.code(200).send(usage);
    },
  );

  // PUT /api/admin/providers/:id/pricing — update provider pricing
  fastify.put(
    '/api/admin/providers/:id/pricing',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { promptPricePerKToken?: number; completionPricePerKToken?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const { promptPricePerKToken, completionPricePerKToken } = request.body ?? {};

      if (promptPricePerKToken === undefined && completionPricePerKToken === undefined) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'At least one of promptPricePerKToken or completionPricePerKToken must be provided',
        });
      }

      const db = getDatabase();

      // Check provider exists
      const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(id);
      if (!provider) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Provider not found: ${id}`,
        });
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      if (promptPricePerKToken !== undefined) {
        updates.push('prompt_price_per_k_token = ?');
        values.push(promptPricePerKToken);
      }
      if (completionPricePerKToken !== undefined) {
        updates.push('completion_price_per_k_token = ?');
        values.push(completionPricePerKToken);
      }

      values.push(id);
      db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return reply.code(200).send({ message: 'Provider pricing updated' });
    },
  );

  // POST /api/admin/reports/cost — generate cost report
  fastify.post(
    '/api/admin/reports/cost',
    async (
      request: FastifyRequest<{
        Body: { start?: string; end?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { start, end } = request.body ?? {};

      if (!start || !end) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'start and end are required in the request body (ISO date strings)',
        });
      }

      const startDate = new Date(start);
      const endDate = new Date(end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'start and end must be valid ISO date strings',
        });
      }

      const report = costCalculator.generateReport({ start: startDate, end: endDate });
      return reply.code(200).send(report);
    },
  );
}
