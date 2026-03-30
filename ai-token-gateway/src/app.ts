// ============================================================
// Fastify Application: Build and configure the app instance
// ============================================================

import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
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

  // Route plugins (API routes take priority over static files)
  await app.register(healthRoutes);
  await app.register(userRoutes);
  await app.register(adminRoutes);
  await app.register(openaiRoutes);
  await app.register(anthropicRoutes);

  // Static file serving for the SPA dashboard
  const publicDir = path.join(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: false,
    });
  }

  // Global error handler: unexpected errors → 500 with stack trace logged
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: error.message,
    });
  });

  // SPA fallback: non-API GET requests that don't match a static file → index.html
  app.setNotFoundHandler((request, reply) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (request.method === 'GET' && !request.url.startsWith('/api/') && existsSync(indexPath)) {
      return reply.sendFile('index.html');
    }
    reply.code(404).send({ error: 'Not Found', message: `Route ${request.method} ${request.url} not found` });
  });

  return app;
}
