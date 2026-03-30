// ============================================================
// Request Logger Middleware: Log each request to the database
// ============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/database.js';
import type { RequestLogEntry } from '../types/index.js';

/**
 * 对 API Key 进行脱敏处理，仅保留最后 4 位字符。
 * 如果 key 长度不足 4 位，全部用 * 替换。
 */
export function maskApiKey(key: string): string {
  if (key.length <= 4) {
    return '****';
  }
  return '****' + key.slice(-4);
}

/**
 * Fastify 插件：请求日志记录。
 * 使用 onRequest 钩子记录请求开始时间，
 * 使用 onResponse 钩子在请求完成后将日志写入 request_logs 表。
 */
export async function requestLoggerPlugin(fastify: FastifyInstance): Promise<void> {
  // Capture start time on every incoming request
  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as unknown as Record<string, unknown>).__startTime = Date.now();
  });

  // Log to database after response is sent
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = (request as unknown as Record<string, unknown>).__startTime as number | undefined;
    const durationMs = startTime ? Date.now() - startTime : 0;

    const userId = request.user?.id;
    const providerId = reply.getHeader('X-Provider') as string | undefined;

    const entry: RequestLogEntry = {
      userId,
      providerId,
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
      durationMs,
    };

    try {
      const db = getDatabase();
      db.prepare(
        `INSERT INTO request_logs (user_id, provider_id, method, path, status_code, duration_ms, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.userId ?? null,
        entry.providerId ?? null,
        entry.method,
        entry.path,
        entry.statusCode,
        entry.durationMs,
        entry.errorMessage ?? null,
      );
    } catch (err) {
      // Logging should never break the request flow
      fastify.log.error({ err }, 'Failed to write request log');
    }
  });
}

// Break Fastify encapsulation so hooks apply to all routes,
// not just routes registered within this plugin's scope.
// This is equivalent to wrapping with fastify-plugin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(requestLoggerPlugin as any)[Symbol.for('skip-override')] = true;
