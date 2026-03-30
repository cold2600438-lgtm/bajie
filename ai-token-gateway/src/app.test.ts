import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from './app.js';
import { initializeDatabase, closeDatabase } from './db/database.js';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const TEST_DB_DIR = './test-data-app';

describe('buildApp', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    dbPath = `${TEST_DB_DIR}/${randomUUID()}.db`;
    initializeDatabase(dbPath);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    closeDatabase();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('should build a Fastify instance', async () => {
    app = await buildApp();
    expect(app).toBeDefined();
  });

  it('should register the health route', async () => {
    app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('providers');
  });

  it('should return 500 with error message for unhandled errors', async () => {
    app = await buildApp();

    // Register a route that throws an unexpected error
    app.get('/test-error', async () => {
      throw new Error('Something went wrong');
    });

    const response = await app.inject({ method: 'GET', url: '/test-error' });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('Something went wrong');
  });

  it('should return 404 for unknown routes', async () => {
    app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(response.statusCode).toBe(404);
  });
});
