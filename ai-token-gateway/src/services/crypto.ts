import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedData } from '../types/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommended for GCM

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * @param plaintext - The string to encrypt
 * @param encryptionKey - A 64-character hex string (32 bytes)
 * @returns EncryptedData with hex-encoded encrypted, iv, and tag fields
 */
export function encrypt(plaintext: string, encryptionKey: string): EncryptedData {
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an EncryptedData object back to the original plaintext.
 * @param data - The EncryptedData containing hex-encoded encrypted, iv, and tag
 * @param encryptionKey - A 64-character hex string (32 bytes)
 * @returns The original plaintext string
 */
export function decrypt(data: EncryptedData, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = Buffer.from(data.iv, 'hex');
  const encrypted = Buffer.from(data.encrypted, 'hex');
  const tag = Buffer.from(data.tag, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}
