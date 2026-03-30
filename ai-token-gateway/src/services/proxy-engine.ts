// ============================================================
// Proxy Engine: Reusable auto-retry with key switching
// ============================================================

import { KeyPoolManager } from './key-pool.js';

export interface ForwardResult {
  statusCode: number;
  body: unknown;
}

export interface ForwardWithRetryOptions {
  provider: string;
  encryptionKey: string;
  forwardFn: (apiKey: string, keyId: string) => Promise<ForwardResult>;
}

export interface ForwardWithRetryResult {
  statusCode: number;
  body: unknown;
  keyId: string;
}

export class ProxyEngine {
  private keyPoolManager: KeyPoolManager;

  constructor(keyPoolManager: KeyPoolManager) {
    this.keyPoolManager = keyPoolManager;
  }

  /**
   * Forward a request with automatic retry and key switching.
   *
   * 1. Get the first key from the pool for the provider
   * 2. Call forwardFn with the decrypted key
   * 3. If 429 or 402, mark key as failed, get next key, retry
   * 4. If successful, mark key as successful
   * 5. If all keys exhausted, return 503
   * 6. Max retries = number of active keys in the pool
   */
  async forwardWithRetry(opts: ForwardWithRetryOptions): Promise<ForwardWithRetryResult> {
    const { provider, encryptionKey, forwardFn } = opts;

    const activeKeyCount = this.keyPoolManager.getActiveKeyIds(provider).length;

    if (activeKeyCount === 0) {
      return {
        statusCode: 503,
        body: {
          error: 'Service Unavailable',
          message: `No available API keys for provider '${provider}'`,
        },
        keyId: '',
      };
    }

    const maxRetries = activeKeyCount;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const keyEntry = this.keyPoolManager.getNextKey(provider, encryptionKey);

      if (!keyEntry) {
        break;
      }

      const result = await forwardFn(keyEntry.key, keyEntry.id);

      if (result.statusCode === 429 || result.statusCode === 402) {
        this.keyPoolManager.markKeyFailure(keyEntry.id);
        continue;
      }

      this.keyPoolManager.markKeySuccess(keyEntry.id);
      return {
        statusCode: result.statusCode,
        body: result.body,
        keyId: keyEntry.id,
      };
    }

    return {
      statusCode: 503,
      body: {
        error: 'Service Unavailable',
        message: `All API keys exhausted for provider '${provider}'`,
      },
      keyId: '',
    };
  }
}
