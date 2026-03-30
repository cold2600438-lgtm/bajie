import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyValidator } from './key-validator.js';

// Mock undici's request function
vi.mock('undici', () => ({
  request: vi.fn(),
}));

import { request } from 'undici';
const mockRequest = vi.mocked(request);

describe('KeyValidator', () => {
  let validator: KeyValidator;

  beforeEach(() => {
    validator = new KeyValidator();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when provider returns 200', async () => {
    mockRequest.mockResolvedValue({ statusCode: 200 } as any);

    const result = await validator.validateKey('valid-key', 'https://api.example.com/anthropic');
    expect(result).toBe(true);
  });

  it('should return true when provider returns 400 (bad request but key is valid)', async () => {
    mockRequest.mockResolvedValue({ statusCode: 400 } as any);

    const result = await validator.validateKey('valid-key', 'https://api.example.com/anthropic');
    expect(result).toBe(true);
  });

  it('should return true when provider returns 429 (rate limited but key is valid)', async () => {
    mockRequest.mockResolvedValue({ statusCode: 429 } as any);

    const result = await validator.validateKey('valid-key', 'https://api.example.com/anthropic');
    expect(result).toBe(true);
  });

  it('should return false when provider returns 401 (unauthorized)', async () => {
    mockRequest.mockResolvedValue({ statusCode: 401 } as any);

    const result = await validator.validateKey('invalid-key', 'https://api.example.com/anthropic');
    expect(result).toBe(false);
  });

  it('should return false when provider returns 403 (forbidden)', async () => {
    mockRequest.mockResolvedValue({ statusCode: 403 } as any);

    const result = await validator.validateKey('invalid-key', 'https://api.example.com/anthropic');
    expect(result).toBe(false);
  });

  it('should return false on network error', async () => {
    mockRequest.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await validator.validateKey('some-key', 'https://unreachable.example.com');
    expect(result).toBe(false);
  });

  it('should return false on timeout', async () => {
    mockRequest.mockRejectedValue(new Error('UND_ERR_HEADERS_TIMEOUT'));

    const result = await validator.validateKey('some-key', 'https://slow.example.com');
    expect(result).toBe(false);
  });

  it('should send correct headers for Anthropic-compatible providers', async () => {
    mockRequest.mockResolvedValue({ statusCode: 200 } as any);

    await validator.validateKey('test-api-key', 'https://api.minimaxi.com/anthropic');

    expect(mockRequest).toHaveBeenCalledWith(
      'https://api.minimaxi.com/anthropic/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-api-key': 'test-api-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('should strip trailing slashes from provider URL', async () => {
    mockRequest.mockResolvedValue({ statusCode: 200 } as any);

    await validator.validateKey('key', 'https://api.example.com/anthropic/');

    expect(mockRequest).toHaveBeenCalledWith(
      'https://api.example.com/anthropic/v1/messages',
      expect.anything(),
    );
  });

  it('should send a minimal request body', async () => {
    mockRequest.mockResolvedValue({ statusCode: 200 } as any);

    await validator.validateKey('key', 'https://api.example.com');

    const callArgs = mockRequest.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body).toEqual({
      model: 'test',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
  });
});
