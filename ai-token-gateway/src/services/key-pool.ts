// ============================================================
// Key Pool Manager: Key CRUD, round-robin selection, failure tracking
// ============================================================

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db/database.js';
import { encrypt, decrypt } from './crypto.js';
import type { ApiKeyEntry, NewApiKeyInput, EncryptedData } from '../types/index.js';

/** Map a raw DB row to an ApiKeyEntry. */
function rowToApiKeyEntry(row: Record<string, unknown>): ApiKeyEntry {
  return {
    id: row.id as string,
    provider: row.provider_id as string,
    encryptedKey: row.encrypted_key as string,
    contributorUserId: row.contributor_user_id as string,
    status: row.status as 'active' | 'disabled' | 'exhausted',
    consecutiveFailures: row.consecutive_failures as number,
    estimatedQuota: (row.estimated_quota as number) ?? 0,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : new Date(),
    createdAt: new Date(row.created_at as string),
  };
}

export class KeyPoolManager {
  /** provider -> round-robin index */
  private roundRobinIndex: Map<string, number> = new Map();
  /** provider -> list of active key IDs */
  private activeKeys: Map<string, string[]> = new Map();

  /**
   * Add a new API key (encrypted) to the pool.
   */
  addKey(input: NewApiKeyInput, encryptionKey: string): ApiKeyEntry {
    const db = getDatabase();
    const keyId = randomUUID();
    const encryptedData = encrypt(input.key, encryptionKey);

    db.prepare(
      `INSERT INTO api_keys (id, provider_id, encrypted_key, encryption_iv, encryption_tag, contributor_user_id, status, consecutive_failures, estimated_quota)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
    ).run(
      keyId,
      input.provider,
      encryptedData.encrypted,
      encryptedData.iv,
      encryptedData.tag,
      input.contributorUserId,
      input.estimatedQuota ?? 0,
    );

    // Add to in-memory active keys
    const providerKeys = this.activeKeys.get(input.provider) ?? [];
    providerKeys.push(keyId);
    this.activeKeys.set(input.provider, providerKeys);

    return {
      id: keyId,
      provider: input.provider,
      encryptedKey: encryptedData.encrypted,
      contributorUserId: input.contributorUserId,
      status: 'active',
      consecutiveFailures: 0,
      estimatedQuota: input.estimatedQuota ?? 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };
  }

  /**
   * Remove a key from the pool (DB + memory).
   */
  removeKey(keyId: string): void {
    const db = getDatabase();

    // Find the provider before deleting so we can clean up memory
    const row = db.prepare('SELECT provider_id FROM api_keys WHERE id = ?').get(keyId) as
      | Record<string, unknown>
      | undefined;

    const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(keyId);
    if (result.changes === 0) {
      throw new Error(`API key not found: ${keyId}`);
    }

    // Remove from in-memory active keys
    if (row) {
      const provider = row.provider_id as string;
      const keys = this.activeKeys.get(provider);
      if (keys) {
        const filtered = keys.filter((id) => id !== keyId);
        if (filtered.length === 0) {
          this.activeKeys.delete(provider);
          this.roundRobinIndex.delete(provider);
        } else {
          this.activeKeys.set(provider, filtered);
          // Adjust round-robin index if needed
          const currentIdx = this.roundRobinIndex.get(provider) ?? 0;
          if (currentIdx >= filtered.length) {
            this.roundRobinIndex.set(provider, 0);
          }
        }
      }
    }
  }

  /**
   * Get the next available key for a provider using round-robin.
   * Returns the decrypted key for use, or null if none available.
   */
  getNextKey(
    provider: string,
    encryptionKey: string,
  ): { id: string; key: string; provider: string } | null {
    const keys = this.activeKeys.get(provider);
    if (!keys || keys.length === 0) {
      return null;
    }

    const db = getDatabase();
    const currentIdx = this.roundRobinIndex.get(provider) ?? 0;
    const nextIdx = currentIdx % keys.length;
    const keyId = keys[nextIdx];

    // Advance the round-robin index
    this.roundRobinIndex.set(provider, nextIdx + 1);

    // Fetch encrypted data from DB
    const row = db.prepare(
      'SELECT encrypted_key, encryption_iv, encryption_tag FROM api_keys WHERE id = ?',
    ).get(keyId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const encryptedData: EncryptedData = {
      encrypted: row.encrypted_key as string,
      iv: row.encryption_iv as string,
      tag: row.encryption_tag as string,
    };

    const decryptedKey = decrypt(encryptedData, encryptionKey);

    // Update last_used_at
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(keyId);

    return { id: keyId, key: decryptedKey, provider };
  }

  /**
   * Mark a key as failed. After 3 consecutive failures, mark as 'exhausted'
   * and remove from the active round-robin pool.
   */
  markKeyFailure(keyId: string): void {
    const db = getDatabase();

    const row = db.prepare(
      'SELECT provider_id, consecutive_failures FROM api_keys WHERE id = ?',
    ).get(keyId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`API key not found: ${keyId}`);
    }

    const newFailures = (row.consecutive_failures as number) + 1;
    const provider = row.provider_id as string;

    if (newFailures >= 3) {
      // Mark as exhausted in DB
      db.prepare(
        'UPDATE api_keys SET consecutive_failures = ?, status = ? WHERE id = ?',
      ).run(newFailures, 'exhausted', keyId);

      // Remove from in-memory active keys
      const keys = this.activeKeys.get(provider);
      if (keys) {
        const filtered = keys.filter((id) => id !== keyId);
        if (filtered.length === 0) {
          this.activeKeys.delete(provider);
          this.roundRobinIndex.delete(provider);
        } else {
          this.activeKeys.set(provider, filtered);
          const currentIdx = this.roundRobinIndex.get(provider) ?? 0;
          if (currentIdx >= filtered.length) {
            this.roundRobinIndex.set(provider, 0);
          }
        }
      }
    } else {
      db.prepare(
        'UPDATE api_keys SET consecutive_failures = ? WHERE id = ?',
      ).run(newFailures, keyId);
    }
  }

  /**
   * Mark a key as successful — resets consecutive failures to 0.
   */
  markKeySuccess(keyId: string): void {
    const db = getDatabase();
    const result = db.prepare(
      'UPDATE api_keys SET consecutive_failures = 0 WHERE id = ?',
    ).run(keyId);

    if (result.changes === 0) {
      throw new Error(`API key not found: ${keyId}`);
    }
  }

  /**
   * Get the list of active key IDs for a provider (from memory).
   */
  getActiveKeyIds(provider: string): string[] {
    return this.activeKeys.get(provider) ?? [];
  }

  /**
   * Load active keys from the database into memory for round-robin.
   * Resets round-robin indexes.
   */
  loadActiveKeys(): void {
    const db = getDatabase();
    const rows = db.prepare(
      "SELECT id, provider_id FROM api_keys WHERE status = 'active'",
    ).all() as Record<string, unknown>[];

    // Clear existing state
    this.activeKeys.clear();
    this.roundRobinIndex.clear();

    for (const row of rows) {
      const provider = row.provider_id as string;
      const keyId = row.id as string;
      const keys = this.activeKeys.get(provider) ?? [];
      keys.push(keyId);
      this.activeKeys.set(provider, keys);
    }
  }

  /**
   * Get the count of active and total keys for a provider.
   */
  getKeyCount(provider: string): { active: number; total: number } {
    const db = getDatabase();

    const totalRow = db.prepare(
      'SELECT COUNT(*) as count FROM api_keys WHERE provider_id = ?',
    ).get(provider) as Record<string, unknown>;

    const activeRow = db.prepare(
      "SELECT COUNT(*) as count FROM api_keys WHERE provider_id = ? AND status = 'active'",
    ).get(provider) as Record<string, unknown>;

    return {
      active: activeRow.count as number,
      total: totalRow.count as number,
    };
  }
}
