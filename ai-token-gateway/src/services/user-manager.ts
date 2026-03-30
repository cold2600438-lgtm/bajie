// ============================================================
// User Manager: Registration, CRUD, and provider access control
// ============================================================

import { randomUUID, randomBytes } from 'node:crypto';
import { getDatabase } from '../db/database.js';
import type {
  UserInfo,
  RegisterInput,
  RegisterResult,
  AdminCreateUserInput,
} from '../types/index.js';

/** Map a raw DB row to a UserInfo object. */
function rowToUserInfo(row: Record<string, unknown>): UserInfo {
  return {
    id: row.id as string,
    username: row.username as string,
    accessToken: row.access_token as string,
    role: row.role as 'user' | 'admin',
    status: row.status as 'active' | 'disabled',
    allowedProviders: row.allowed_providers
      ? JSON.parse(row.allowed_providers as string)
      : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/** Generate a cryptographically random access token (hex string). */
function generateAccessToken(): string {
  return randomBytes(32).toString('hex');
}

export class UserManager {
  /**
   * User self-registration.
   * Generates a UUID userId and a random access token.
   */
  register(input: RegisterInput): RegisterResult {
    const db = getDatabase();
    const userId = randomUUID();
    const accessToken = generateAccessToken();

    db.prepare(
      `INSERT INTO users (id, username, access_token, role, status)
       VALUES (?, ?, ?, 'user', 'active')`,
    ).run(userId, input.username, accessToken);

    return { userId, accessToken };
  }

  /**
   * Admin creates a new user with optional role and provider restrictions.
   */
  createUser(input: AdminCreateUserInput): UserInfo {
    const db = getDatabase();
    const userId = randomUUID();
    const accessToken = generateAccessToken();
    const role = input.role ?? 'user';
    const allowedProviders = input.allowedProviders
      ? JSON.stringify(input.allowedProviders)
      : null;

    db.prepare(
      `INSERT INTO users (id, username, access_token, role, status, allowed_providers)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).run(userId, input.username, accessToken, role, allowedProviders);

    return {
      id: userId,
      username: input.username,
      accessToken,
      role,
      status: 'active',
      allowedProviders: input.allowedProviders ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Disable a user account (sets status to 'disabled').
   */
  disableUser(userId: string): void {
    const db = getDatabase();
    const result = db.prepare(
      `UPDATE users SET status = 'disabled', updated_at = datetime('now') WHERE id = ?`,
    ).run(userId);

    if (result.changes === 0) {
      throw new Error(`User not found: ${userId}`);
    }
  }

  /**
   * Delete a user account permanently.
   */
  deleteUser(userId: string): void {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    if (result.changes === 0) {
      throw new Error(`User not found: ${userId}`);
    }
  }

  /**
   * Set the list of providers a user is allowed to access.
   * Pass an empty array to deny all; the DB stores JSON.
   */
  setUserProviders(userId: string, providers: string[]): void {
    const db = getDatabase();
    const result = db.prepare(
      `UPDATE users SET allowed_providers = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(providers), userId);

    if (result.changes === 0) {
      throw new Error(`User not found: ${userId}`);
    }
  }

  /**
   * Check whether a user has access to a given provider.
   * Returns true if allowed_providers is null (all allowed) or contains the provider.
   */
  checkProviderAccess(userId: string, provider: string): boolean {
    const user = this.getUserById(userId);
    if (!user) {
      return false;
    }
    if (user.status === 'disabled') {
      return false;
    }
    // null means all providers are allowed
    if (user.allowedProviders === null) {
      return true;
    }
    return user.allowedProviders.includes(provider);
  }

  /**
   * Look up a user by ID.
   */
  getUserById(userId: string): UserInfo | null {
    const db = getDatabase();
    const row = db.prepare(
      'SELECT id, username, access_token, role, status, allowed_providers, created_at, updated_at FROM users WHERE id = ?',
    ).get(userId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }
    return rowToUserInfo(row);
  }

  /**
   * Reset a user's access token. Generates a new random token and updates the DB.
   * Returns the new token. Throws if user not found.
   */
  resetToken(userId: string): string {
    const db = getDatabase();
    const newToken = generateAccessToken();
    const result = db.prepare(
      `UPDATE users SET access_token = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(newToken, userId);

    if (result.changes === 0) {
      throw new Error(`User not found: ${userId}`);
    }

    return newToken;
  }

  /**
   * List all users.
   */
  listUsers(): UserInfo[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT id, username, access_token, role, status, allowed_providers, created_at, updated_at FROM users ORDER BY created_at',
    ).all() as Record<string, unknown>[];

    return rows.map(rowToUserInfo);
  }
}
