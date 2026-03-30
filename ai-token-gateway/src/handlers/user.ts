// ============================================================
// User Routes: Self-registration and user-facing endpoints
// ============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { UserManager } from '../services/user-manager.js';
import { KeyValidator } from '../services/key-validator.js';
import { KeyPoolManager } from '../services/key-pool.js';
import { UsageTracker } from '../services/usage-tracker.js';
import { getDatabase } from '../db/database.js';

const userManager = new UserManager();
const keyValidator = new KeyValidator();
const keyPoolManager = new KeyPoolManager();
const usageTracker = new UsageTracker();

/**
 * Fastify plugin that registers user-facing routes.
 * The register endpoint does NOT require authentication.
 */
export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/user/register — self-registration (no auth required)
  fastify.post(
    '/api/user/register',
    async (
      request: FastifyRequest<{
        Body: { username: string; apiKey?: string; apiKeyProvider?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { username, apiKey, apiKeyProvider } = request.body ?? {};

      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'username is required and must be a non-empty string',
        });
      }

      try {
        const result = userManager.register({ username: username.trim() });

        // If user submitted an API key, validate and add to pool
        if (apiKey && apiKeyProvider) {
          const db = getDatabase();
          const providerRow = db.prepare(
            'SELECT api_base_url FROM providers WHERE id = ?',
          ).get(apiKeyProvider) as Record<string, unknown> | undefined;

          if (!providerRow) {
            return reply.code(201).send({
              ...result,
              apiKeyValid: false,
            });
          }

          const providerBaseUrl = providerRow.api_base_url as string;
          const isValid = await keyValidator.validateKey(apiKey, providerBaseUrl);

          if (isValid) {
            const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
            keyPoolManager.addKey(
              {
                provider: apiKeyProvider,
                key: apiKey,
                contributorUserId: result.userId,
              },
              encryptionKey,
            );
          }

          return reply.code(201).send({
            ...result,
            apiKeyValid: isValid,
          });
        }

        return reply.code(201).send(result);
      } catch (err: unknown) {
        // SQLite UNIQUE constraint → duplicate username
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

  // POST /api/user/reset-token — reset own access token (requires auth)
  fastify.post(
    '/api/user/reset-token',
    { preHandler: authMiddleware },
    async (request, reply) => {
      try {
        const newToken = userManager.resetToken(request.user!.id);
        return reply.code(200).send({ accessToken: newToken });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('User not found')) {
          return reply.code(404).send({
            error: 'Not Found',
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  // GET /api/user/profile — get current user info (requires auth)
  fastify.get(
    '/api/user/profile',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const user = request.user!;
      return reply.code(200).send({
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        allowedProviders: user.allowedProviders,
      });
    },
  );

  // GET /api/user/usage — query personal usage (requires auth)
  fastify.get<{
    Querystring: { start?: string; end?: string; granularity?: string };
  }>(
    '/api/user/usage',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { start, end, granularity } = request.query;

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

      const validGranularities = ['day', 'week', 'month'];
      const gran = (granularity && validGranularities.includes(granularity))
        ? granularity as 'day' | 'week' | 'month'
        : 'day';

      const usage = usageTracker.getUserUsage(
        request.user!.id,
        { start: startDate, end: endDate },
        gran,
      );

      return reply.code(200).send(usage);
    },
  );
}
