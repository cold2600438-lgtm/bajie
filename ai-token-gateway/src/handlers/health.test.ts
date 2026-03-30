import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { initializeDatabase, closeDatabase, getDatabase } from '../db/database.js';
import { healthRoutes } from './health.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-health-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

function seedProvider(id: string) {
  const db = getDatabase();
  db.prepare(
    'INSERT OR IGNORE INTO providers (id, name, api_base_url) VALUES (?, ?, ?)',
  ).run(id, id, `https://${id}.example.com`);
}

function seedApiKey(id: string, providerId: string, status: string = 'active') {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, status)
     VALUES (?, ?, 'enc', 'iv', 'tag', ?)`,
  ).run(id, providerId, status);
}

describe('GET /health', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  async function buildApp() {
    const app = Fastify();
    await app.register(healthRoutes);
    return app;
  }

  it('should return "down" when no providers exist', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('down');
    expect(body.providers).toEqual([]);
  });

  it('should return "ok" when all providers have available keys', async () => {
    seedProvider('minimax');
    seedProvider('glm');
    seedApiKey('k1', 'minimax', 'active');
    seedApiKey('k2', 'minimax', 'active');
    seedApiKey('k3', 'glm', 'active');

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.providers).toHaveLength(2);

    const minimax = body.providers.find((p: { provider: string }) => p.provider === 'minimax');
    expect(minimax.availableKeys).toBe(2);
    expect(minimax.totalKeys).toBe(2);

    const glm = body.providers.find((p: { provider: string }) => p.provider === 'glm');
    expect(glm.availableKeys).toBe(1);
    expect(glm.totalKeys).toBe(1);
  });

  it('should return "degraded" when some providers have no available keys', async () => {
    seedProvider('minimax');
    seedProvider('glm');
    seedApiKey('k1', 'minimax', 'active');
    seedApiKey('k2', 'glm', 'exhausted');
    seedApiKey('k3', 'glm', 'disabled');

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.status).toBe('degraded');

    const minimax = body.providers.find((p: { provider: string }) => p.provider === 'minimax');
    expect(minimax.availableKeys).toBe(1);
    expect(minimax.totalKeys).toBe(1);

    const glm = body.providers.find((p: { provider: string }) => p.provider === 'glm');
    expect(glm.availableKeys).toBe(0);
    expect(glm.totalKeys).toBe(2);
  });

  it('should return "down" when all providers have no available keys', async () => {
    seedProvider('minimax');
    seedProvider('glm');
    seedApiKey('k1', 'minimax', 'exhausted');
    seedApiKey('k2', 'glm', 'disabled');

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.status).toBe('down');
  });

  it('should not require authentication', async () => {
    seedProvider('minimax');
    seedApiKey('k1', 'minimax', 'active');

    const app = await buildApp();
    // No auth headers at all
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('should count mixed key statuses correctly', async () => {
    seedProvider('minimax');
    seedApiKey('k1', 'minimax', 'active');
    seedApiKey('k2', 'minimax', 'active');
    seedApiKey('k3', 'minimax', 'disabled');
    seedApiKey('k4', 'minimax', 'exhausted');
    seedApiKey('k5', 'minimax', 'active');

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.providers[0].availableKeys).toBe(3);
    expect(body.providers[0].totalKeys).toBe(5);
  });
});
