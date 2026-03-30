// ============================================================
// Fastify Application: Build and configure the app instance
// ============================================================

import Fastify, { type FastifyInstance } from 'fastify';
import { requestLoggerPlugin } from './middleware/request-logger.js';
import { healthRoutes } from './handlers/health.js';
import { userRoutes } from './handlers/user.js';
import { adminRoutes } from './handlers/admin.js';
import { openaiRoutes } from './handlers/openai.js';
import { anthropicRoutes } from './handlers/anthropic.js';

/**
 * Build and return a fully configured Fastify instance with all
 * middleware and route plugins registered.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  // Global request logging (writes to request_logs table)
  await app.register(requestLoggerPlugin);

  // Route plugins
  await app.register(healthRoutes);
  await app.register(userRoutes);
  await app.register(adminRoutes);
  await app.register(openaiRoutes);
  await app.register(anthropicRoutes);

  // Global error handler: unexpected errors → 500 with stack trace logged
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: error.message,
    });
  });

  return app;
}
