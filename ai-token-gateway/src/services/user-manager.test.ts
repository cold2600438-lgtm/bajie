import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase, closeDatabase } from '../db/database.js';
import { UserManager } from './user-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `test-user-mgr-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanup(dbPath: string) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
}

describe('UserManager', () => {
  let dbPath: string;
  let mgr: UserManager;

  beforeEach(() => {
    dbPath = tmpDbPath();
    initializeDatabase(dbPath);
    mgr = new UserManager();
  });

  afterEach(() => {
    cleanup(dbPath);
  });

  // --- register ---

  describe('register', () => {
    it('should create a user and return userId + accessToken', () => {
      const result = mgr.register({ username: 'alice' });
      expect(result.userId).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.accessToken.length).toBe(64); // 32 bytes hex
    });

    it('should persist the user in the database', () => {
      const result = mgr.register({ username: 'bob' });
      const user = mgr.getUserById(result.userId);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('bob');
      expect(user!.role).toBe('user');
      expect(user!.status).toBe('active');
      expect(user!.allowedProviders).toBeNull();
    });

    it('should reject duplicate usernames', () => {
      mgr.register({ username: 'charlie' });
      expect(() => mgr.register({ username: 'charlie' })).toThrow();
    });
  });

  // --- createUser ---

  describe('createUser', () => {
    it('should create a user with default role', () => {
      const user = mgr.createUser({ username: 'dave' });
      expect(user.role).toBe('user');
      expect(user.status).toBe('active');
      expect(user.accessToken.length).toBe(64);
    });

    it('should create an admin user', () => {
      const user = mgr.createUser({ username: 'admin1', role: 'admin' });
      expect(user.role).toBe('admin');
    });

    it('should set allowed providers', () => {
      const user = mgr.createUser({
        username: 'eve',
        allowedProviders: ['kimi', 'minimax'],
      });
      expect(user.allowedProviders).toEqual(['kimi', 'minimax']);

      // Verify persisted
      const fetched = mgr.getUserById(user.id);
      expect(fetched!.allowedProviders).toEqual(['kimi', 'minimax']);
    });
  });

  // --- disableUser ---

  describe('disableUser', () => {
    it('should set user status to disabled', () => {
      const { userId } = mgr.register({ username: 'frank' });
      mgr.disableUser(userId);
      const user = mgr.getUserById(userId);
      expect(user!.status).toBe('disabled');
    });

    it('should throw for non-existent user', () => {
      expect(() => mgr.disableUser('nonexistent')).toThrow('User not found');
    });
  });

  // --- deleteUser ---

  describe('deleteUser', () => {
    it('should remove the user from the database', () => {
      const { userId } = mgr.register({ username: 'grace' });
      mgr.deleteUser(userId);
      expect(mgr.getUserById(userId)).toBeNull();
    });

    it('should throw for non-existent user', () => {
      expect(() => mgr.deleteUser('nonexistent')).toThrow('User not found');
    });
  });

  // --- setUserProviders ---

  describe('setUserProviders', () => {
    it('should update allowed providers', () => {
      const { userId } = mgr.register({ username: 'heidi' });
      mgr.setUserProviders(userId, ['glm']);
      const user = mgr.getUserById(userId);
      expect(user!.allowedProviders).toEqual(['glm']);
    });

    it('should allow setting an empty array', () => {
      const { userId } = mgr.register({ username: 'ivan' });
      mgr.setUserProviders(userId, []);
      const user = mgr.getUserById(userId);
      expect(user!.allowedProviders).toEqual([]);
    });

    it('should throw for non-existent user', () => {
      expect(() => mgr.setUserProviders('nonexistent', ['kimi'])).toThrow('User not found');
    });
  });

  // --- checkProviderAccess ---

  describe('checkProviderAccess', () => {
    it('should return true when allowedProviders is null (all allowed)', () => {
      const { userId } = mgr.register({ username: 'judy' });
      expect(mgr.checkProviderAccess(userId, 'kimi')).toBe(true);
      expect(mgr.checkProviderAccess(userId, 'anything')).toBe(true);
    });

    it('should return true when provider is in the allowed list', () => {
      const { userId } = mgr.register({ username: 'karl' });
      mgr.setUserProviders(userId, ['kimi', 'minimax']);
      expect(mgr.checkProviderAccess(userId, 'kimi')).toBe(true);
      expect(mgr.checkProviderAccess(userId, 'minimax')).toBe(true);
    });

    it('should return false when provider is not in the allowed list', () => {
      const { userId } = mgr.register({ username: 'liam' });
      mgr.setUserProviders(userId, ['kimi']);
      expect(mgr.checkProviderAccess(userId, 'glm')).toBe(false);
    });

    it('should return false for disabled users', () => {
      const { userId } = mgr.register({ username: 'mia' });
      mgr.disableUser(userId);
      expect(mgr.checkProviderAccess(userId, 'kimi')).toBe(false);
    });

    it('should return false for non-existent users', () => {
      expect(mgr.checkProviderAccess('nonexistent', 'kimi')).toBe(false);
    });
  });

  // --- getUserById ---

  describe('getUserById', () => {
    it('should return null for non-existent user', () => {
      expect(mgr.getUserById('nonexistent')).toBeNull();
    });

    it('should return full user info', () => {
      const result = mgr.register({ username: 'nina' });
      const user = mgr.getUserById(result.userId)!;
      expect(user.id).toBe(result.userId);
      expect(user.username).toBe('nina');
      expect(user.accessToken).toBe(result.accessToken);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });
  });

  // --- listUsers ---

  describe('listUsers', () => {
    it('should return empty array when no users exist', () => {
      expect(mgr.listUsers()).toEqual([]);
    });

    it('should return all users', () => {
      mgr.register({ username: 'user1' });
      mgr.register({ username: 'user2' });
      mgr.createUser({ username: 'admin1', role: 'admin' });

      const users = mgr.listUsers();
      expect(users).toHaveLength(3);
      const names = users.map((u) => u.username);
      expect(names).toContain('user1');
      expect(names).toContain('user2');
      expect(names).toContain('admin1');
    });
  });
});
