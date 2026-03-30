// ============================================================
// Key Validator: Validates API keys by sending lightweight
// requests to provider APIs (Anthropic-compatible endpoints)
// ============================================================

import { request } from 'undici';

const VALIDATION_TIMEOUT_MS = 10_000;

export class KeyValidator {
  /**
   * Validate an API key by sending a minimal request to the provider.
   * For Anthropic-compatible providers (MiniMax, GLM), sends a minimal
   * POST to /v1/messages. A 401/403 means invalid key; anything else
   * (including 200 or other errors like 400) means the key is valid.
   *
   * @returns true if the key is valid, false otherwise
   */
  async validateKey(apiKey: string, providerBaseUrl: string): Promise<boolean> {
    try {
      const url = `${providerBaseUrl.replace(/\/+$/, '')}/v1/messages`;

      const { statusCode } = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'test',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        headersTimeout: VALIDATION_TIMEOUT_MS,
        bodyTimeout: VALIDATION_TIMEOUT_MS,
      });

      // 401/403 = invalid key, anything else = key is valid
      return statusCode !== 401 && statusCode !== 403;
    } catch {
      // Network errors, timeouts, DNS failures, etc.
      return false;
    }
  }
}
