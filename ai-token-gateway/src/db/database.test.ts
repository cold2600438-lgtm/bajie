import { describe, it, expect, afterEach } from 'vitest';
import { initializeDatabase, getDatabase, closeDatabase } from './database.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `test-gateway-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

describe('database module', () => {
  let dbPath: string;

  afterEach(() => {
    if (dbPath) cleanup(dbPath);
  });

  it('should initialize database and create all tables', () => {
    dbPath = tmpDbPath();
    const db = initializeDatabase(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('providers');
    expect(tableNames).toContain('api_keys');
    expect(tableNames).toContain('token_usage');
    expect(tableNames).toContain('request_logs');
  });

  it('should create all indexes', () => {
    dbPath = tmpDbPath();
    const db = initializeDatabase(dbPath);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_token_usage_user_created');
    expect(indexNames).toContain('idx_token_usage_provider_created');
    expect(indexNames).toContain('idx_request_logs_user_created');
    expect(indexNames).toContain('idx_api_keys_provider_status');
    expect(indexNames).toContain('idx_users_access_token');
  });

  it('should return the same instance on repeated init calls', () => {
    dbPath = tmpDbPath();
    const db1 = initializeDatabase(dbPath);
    const db2 = initializeDatabase(dbPath);
    expect(db1).toBe(db2);
  });

  it('getDatabase should return the initialized instance', () => {
    dbPath = tmpDbPath();
    const db = initializeDatabase(dbPath);
    expect(getDatabase()).toBe(db);
  });

  it('getDatabase should throw if not initialized', () => {
    dbPath = tmpDbPath();
    // ensure closed state
    closeDatabase();
    expect(() => getDatabase()).toThrow('Database not initialized');
  });

  it('closeDatabase should allow re-initialization', () => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    closeDatabase();

    // Should be able to init again
    const db = initializeDatabase(dbPath);
    expect(db).toBeDefined();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('users');
  });

  it('should enable WAL mode and foreign keys', () => {
    dbPath = tmpDbPath();
    const db = initializeDatabase(dbPath);

    const journalMode = db.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');

    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('should enforce foreign key constraints', () => {
    dbPath = tmpDbPath();
    const db = initializeDatabase(dbPath);

    // Inserting an api_key with a non-existent provider_id should fail
    expect(() => {
      db.prepare(`
        INSERT INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, status)
        VALUES ('k1', 'nonexistent', 'enc', 'iv', 'tag', 'active')
      `).run();
    }).toThrow();
  });
});
