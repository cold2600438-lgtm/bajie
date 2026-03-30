import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto.js';
import { randomBytes } from 'node:crypto';

// Helper: generate a valid 64-char hex encryption key
function generateKey(): string {
  return randomBytes(32).toString('hex');
}

describe('crypto', () => {
  const key = generateKey();

  describe('encrypt', () => {
    it('returns EncryptedData with hex-encoded fields', () => {
      const result = encrypt('hello world', key);
      expect(result).toHaveProperty('encrypted');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('tag');
      // All fields should be valid hex strings
      expect(result.encrypted).toMatch(/^[0-9a-f]+$/);
      expect(result.iv).toMatch(/^[0-9a-f]{24}$/); // 12 bytes = 24 hex chars
      expect(result.tag).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
    });

    it('generates a unique IV for each call', () => {
      const a = encrypt('same text', key);
      const b = encrypt('same text', key);
      expect(a.iv).not.toBe(b.iv);
      expect(a.encrypted).not.toBe(b.encrypted);
    });
  });

  describe('decrypt', () => {
    it('recovers the original plaintext', () => {
      const plaintext = 'sk-abc123-my-secret-key';
      const encrypted = encrypt(plaintext, key);
      expect(decrypt(encrypted, key)).toBe(plaintext);
    });

    it('handles empty string', () => {
      const encrypted = encrypt('', key);
      expect(decrypt(encrypted, key)).toBe('');
    });

    it('handles unicode content', () => {
      const plaintext = '密钥测试 🔑 clé secrète';
      const encrypted = encrypt(plaintext, key);
      expect(decrypt(encrypted, key)).toBe(plaintext);
    });

    it('throws with wrong encryption key', () => {
      const encrypted = encrypt('secret', key);
      const wrongKey = generateKey();
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });

    it('throws with tampered ciphertext', () => {
      const encrypted = encrypt('secret', key);
      // Flip a character in the encrypted data
      const tampered = { ...encrypted, encrypted: 'ff' + encrypted.encrypted.slice(2) };
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it('throws with tampered auth tag', () => {
      const encrypted = encrypt('secret', key);
      const tampered = { ...encrypted, tag: '00'.repeat(16) };
      expect(() => decrypt(tampered, key)).toThrow();
    });
  });
});
