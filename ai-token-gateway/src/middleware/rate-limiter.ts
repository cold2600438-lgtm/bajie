// ============================================================
// Rate Limiter Middleware: Sliding window per-user rate limiting
// ============================================================

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RateLimitResult, AppConfig } from '../types/index.js';

/**
 * 滑动窗口限流器。
 * 在内存中为每个用户维护请求时间戳数组，
 * 每次 consume 时清理过期条目并判断是否超限。
 */
export class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * 尝试消费一次配额。
   * 清理窗口外的过期时间戳，然后判断是否允许本次请求。
   */
  consume(userId: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.windows.get(userId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(userId, timestamps);
    }

    // 清理过期时间戳
    const firstValid = timestamps.findIndex((t) => t > windowStart);
    if (firstValid > 0) {
      timestamps.splice(0, firstValid);
    } else if (firstValid === -1 && timestamps.length > 0) {
      timestamps.length = 0;
    }

    const remaining = Math.max(0, this.maxRequests - timestamps.length);
    const resetAt = timestamps.length > 0
      ? new Date(timestamps[0] + this.windowMs)
      : new Date(now + this.windowMs);

    if (timestamps.length >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt };
    }

    timestamps.push(now);

    return {
      allowed: true,
      remaining: remaining - 1,
      resetAt,
    };
  }
}


/**
 * Fastify preHandler hook：限流中间件。
 * 从 request.user 获取 userId，调用 RateLimiter.consume 判断是否超限。
 * 超限时返回 429 并设置 Retry-After 和 X-RateLimit-Remaining 响应头。
 */
export async function rateLimitMiddleware(
  limiter: RateLimiter,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user?.id;
  if (!userId) {
    // 未认证的请求不做限流（由 auth 中间件拦截）
    return;
  }

  const result = limiter.consume(userId);

  reply.header('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil(
      (result.resetAt.getTime() - Date.now()) / 1000,
    );
    reply.header('Retry-After', String(Math.max(1, retryAfterSeconds)));
    return reply.code(429).send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
      retryAfter: Math.max(1, retryAfterSeconds),
    });
  }
}

/**
 * 工厂函数：根据 AppConfig 创建限流中间件 preHandler hook。
 */
export function createRateLimitMiddleware(
  config: Pick<AppConfig, 'rateLimitMax' | 'rateLimitWindowMs'>,
): { limiter: RateLimiter; hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void> } {
  const limiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);

  const hook = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    return rateLimitMiddleware(limiter, request, reply);
  };

  return { limiter, hook };
}
