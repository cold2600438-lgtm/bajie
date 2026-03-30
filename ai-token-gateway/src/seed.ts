// ============================================================
// Seed Script: Pre-populate database with test providers and keys
// ============================================================

import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { initializeDatabase, closeDatabase } from './db/database.js';
import { encrypt } from './services/crypto.js';

function main(): void {
  const config = loadConfig();

  // Ensure the data directory exists
  const dbDir = dirname(config.databasePath);
  mkdirSync(dbDir, { recursive: true });

  // Initialize database (creates tables if needed)
  const db = initializeDatabase(config.databasePath);

  console.log('Seeding database...\n');

  // ----------------------------------------------------------
  // 1. Insert providers (INSERT OR IGNORE for idempotency)
  // ----------------------------------------------------------
  const insertProvider = db.prepare(`
    INSERT OR IGNORE INTO providers (id, name, api_base_url, is_default)
    VALUES (?, ?, ?, ?)
  `);

  insertProvider.run('minimax', 'MiniMax', 'https://api.minimaxi.com/anthropic', 1);
  console.log('✓ Provider: MiniMax (default)');

  insertProvider.run('glm', 'GLM', 'https://open.bigmodel.cn/api/anthropic', 0);
  console.log('✓ Provider: GLM');

  // ----------------------------------------------------------
  // 2. Create admin user (INSERT OR IGNORE for idempotency)
  // ----------------------------------------------------------
  const adminId = 'admin';
  const adminToken = randomBytes(32).toString('hex');

  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, access_token, role, status)
    VALUES (?, ?, ?, 'admin', 'active')
  `).run(adminId, 'admin', adminToken);

  // Retrieve the actual token (may already exist from a previous run)
  const adminRow = db.prepare('SELECT access_token FROM users WHERE id = ?').get(adminId) as
    | { access_token: string }
    | undefined;

  const actualAdminToken = adminRow?.access_token ?? adminToken;
  console.log('✓ Admin user: admin');

  // ----------------------------------------------------------
  // 3. Insert test API keys (encrypted, INSERT OR IGNORE)
  // ----------------------------------------------------------
  const minimaxPlainKey =
    'sk-cp-Xt5lRqzsIZ0Wrut7HvF-tYBHQ-5okitzu4KIKG-dz06DRoR5sl91dcbTPWOBfsnYASBZtQayc4vprwFcdHx1WuKYUc7L4QOO73CGSH7fNJOAluR5fyjA_2c';
  const glmPlainKey = '958a2bce3f32412791c2a745ab88d716.86r5gjIPg6at9khE';

  const insertKey = db.prepare(`
    INSERT OR IGNORE INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `);

  const minimaxEnc = encrypt(minimaxPlainKey, config.encryptionKey);
  insertKey.run(
    'minimax-key-1',
    'minimax',
    minimaxEnc.encrypted,
    minimaxEnc.iv,
    minimaxEnc.tag,
    adminId,
  );
  console.log('✓ API Key: MiniMax (minimax-key-1)');

  const glmEnc = encrypt(glmPlainKey, config.encryptionKey);
  insertKey.run('glm-key-1', 'glm', glmEnc.encrypted, glmEnc.iv, glmEnc.tag, adminId);
  console.log('✓ API Key: GLM (glm-key-1)');

  // ----------------------------------------------------------
  // Done
  // ----------------------------------------------------------
  console.log('\n--- Seed complete ---');
  console.log(`Admin access token: ${actualAdminToken}`);
  console.log('\nUse this token in the Authorization header:');
  console.log(`  Authorization: Bearer ${actualAdminToken}`);

  closeDatabase();
}

main();
