import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, rateLimitMiddleware, createRateLimitMiddleware } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('should allow requests within the limit', () => {
    const limiter = new RateLimiter(5, 60_000);
    const result = limiter.consume('user1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it('should reject requests exceeding the limit', () => {
    const limiter = new RateLimiter(3, 60_000);
    limiter.consume('user1');
    limiter.consume('user1');
    limiter.consume('user1');
    const result = limiter.consume('user1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should track users independently', () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.consume('user1');
    limiter.consume('user1');
    const r1 = limiter.consume('user1');
    const r2 = limiter.consume('user2');
    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it('should clean up expired timestamps and allow new requests', () => {
    const limiter = new RateLimiter(2, 1000);
    const now = Date.now();

    // Manually inject old timestamps
    vi.spyOn(Date, 'now').mockReturnValue(now);
    limiter.consume('user1');
    limiter.consume('user1');

    // Move time forward past the window
    vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
    const result = limiter.consume('user1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);

    vi.restoreAllMocks();
  });

  it('should return correct resetAt time', () => {
    const limiter = new RateLimiter(2, 60_000);
    const before = Date.now();
    const r1 = limiter.consume('user1');
    const after = Date.now();

    // resetAt should be roughly now + windowMs
    expect(r1.resetAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(r1.resetAt.getTime()).toBeLessThanOrEqual(after + 60_000);
  });

  it('should decrement remaining correctly', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.consume('u').remaining).toBe(2);
    expect(limiter.consume('u').remaining).toBe(1);
    expect(limiter.consume('u').remaining).toBe(0);
  });
});

describe('rateLimitMiddleware', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(2, 60_000);
  });

  function mockRequest(userId?: string) {
    return {
      user: userId ? { id: userId } : undefined,
    } as any;
  }

  function mockReply() {
    const headers: Record<string, string> = {};
    const reply = {
      header: vi.fn((key: string, val: string) => {
        headers[key] = val;
        return reply;
      }),
      code: vi.fn((status: number) => {
        (reply as any)._status = status;
        return reply;
      }),
      send: vi.fn((body: unknown) => {
        (reply as any)._body = body;
        return reply;
      }),
      _headers: headers,
    };
    return reply;
  }

  it('should skip rate limiting for unauthenticated requests', async () => {
    const req = mockRequest();
    const rep = mockReply();
    await rateLimitMiddleware(limiter, req, rep as any);
    expect(rep.code).not.toHaveBeenCalled();
    expect(rep.header).not.toHaveBeenCalled();
  });

  it('should set X-RateLimit-Remaining header on allowed requests', async () => {
    const req = mockRequest('user1');
    const rep = mockReply();
    await rateLimitMiddleware(limiter, req, rep as any);
    expect(rep.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '1');
    expect(rep.code).not.toHaveBeenCalled();
  });

  it('should return 429 when rate limit exceeded', async () => {
    const req = mockRequest('user1');
    const rep1 = mockReply();
    const rep2 = mockReply();
    const rep3 = mockReply();

    await rateLimitMiddleware(limiter, req, rep1 as any);
    await rateLimitMiddleware(limiter, req, rep2 as any);
    await rateLimitMiddleware(limiter, req, rep3 as any);

    expect(rep3.code).toHaveBeenCalledWith(429);
    expect(rep3.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Too Many Requests',
      }),
    );
    expect(rep3.header).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(rep3.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });
});

describe('createRateLimitMiddleware', () => {
  it('should create a limiter and hook from config', () => {
    const { limiter, hook } = createRateLimitMiddleware({
      rateLimitMax: 10,
      rateLimitWindowMs: 30_000,
    });
    expect(limiter).toBeInstanceOf(RateLimiter);
    expect(typeof hook).toBe('function');
  });

  it('should use config values for rate limiting', async () => {
    const { limiter } = createRateLimitMiddleware({
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
    });
    const r1 = limiter.consume('u');
    const r2 = limiter.consume('u');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(false);
  });
});
