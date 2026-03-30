import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

// Valid 64-char hex key for tests
const VALID_KEY = 'a'.repeat(64);

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set minimum required env vars
    process.env.ENCRYPTION_KEY = VALID_KEY;
    process.env.ADMIN_TOKEN = 'test-admin-token';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should load config with default values', () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe('./data/gateway.db');
    expect(config.encryptionKey).toBe(VALID_KEY);
    expect(config.adminToken).toBe('test-admin-token');
    expect(config.rateLimitMax).toBe(60);
    expect(config.rateLimitWindowMs).toBe(60000);
  });

  it('should load config from environment variables', () => {
    process.env.PORT = '8080';
    process.env.DATABASE_PATH = '/tmp/test.db';
    process.env.RATE_LIMIT_MAX = '100';
    process.env.RATE_LIMIT_WINDOW_MS = '30000';

    const config = loadConfig();
    expect(config.port).toBe(8080);
    expect(config.databasePath).toBe('/tmp/test.db');
    expect(config.rateLimitMax).toBe(100);
    expect(config.rateLimitWindowMs).toBe(30000);
  });

  it('should throw if ENCRYPTION_KEY is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => loadConfig()).toThrow('ENCRYPTION_KEY is required');
  });

  it('should throw if ENCRYPTION_KEY is not 64-char hex', () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    expect(() => loadConfig()).toThrow('ENCRYPTION_KEY must be a 64-character hex string');
  });

  it('should throw if ADMIN_TOKEN is missing', () => {
    delete process.env.ADMIN_TOKEN;
    expect(() => loadConfig()).toThrow('ADMIN_TOKEN is required');
  });

  it('should throw if PORT is invalid', () => {
    process.env.PORT = 'abc';
    expect(() => loadConfig()).toThrow('Invalid PORT');
  });

  it('should throw if PORT is out of range', () => {
    process.env.PORT = '99999';
    expect(() => loadConfig()).toThrow('Invalid PORT');
  });

  it('should throw if RATE_LIMIT_MAX is not positive', () => {
    process.env.RATE_LIMIT_MAX = '0';
    expect(() => loadConfig()).toThrow('RATE_LIMIT_MAX must be a positive integer');
  });

  it('should throw if RATE_LIMIT_WINDOW_MS is too small', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '500';
    expect(() => loadConfig()).toThrow('RATE_LIMIT_WINDOW_MS must be at least 1000');
  });
});
