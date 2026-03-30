// ============================================================
// Health Check Route: GET /health — no authentication required
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDatabase } from '../db/database.js';
import type { HealthStatus, ProviderHealthInfo } from '../types/index.js';

/**
 * Fastify plugin that registers the health-check route.
 * No authentication is required for this endpoint.
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const db = getDatabase();

    // Fetch all providers
    const providers = db
      .prepare('SELECT id FROM providers')
      .all() as { id: string }[];

    const providerInfos: ProviderHealthInfo[] = providers.map((p) => {
      const totalRow = db
        .prepare('SELECT COUNT(*) as count FROM api_keys WHERE provider_id = ?')
        .get(p.id) as { count: number };

      const activeRow = db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE provider_id = ? AND status = 'active'")
        .get(p.id) as { count: number };

      return {
        provider: p.id,
        availableKeys: activeRow.count,
        totalKeys: totalRow.count,
      };
    });

    // Determine overall status
    let status: HealthStatus['status'];
    if (providerInfos.length === 0) {
      status = 'down';
    } else {
      const allDown = providerInfos.every((p) => p.availableKeys === 0);
      const someDown = providerInfos.some((p) => p.availableKeys === 0);

      if (allDown) {
        status = 'down';
      } else if (someDown) {
        status = 'degraded';
      } else {
        status = 'ok';
      }
    }

    return reply.code(200).send({ status, providers: providerInfos });
  });
}
