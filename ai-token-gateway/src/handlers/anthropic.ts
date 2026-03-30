// ============================================================
// Anthropic Protocol Handler: Proxy routes for Anthropic-compatible API
// ============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
import { authMiddleware } from '../middleware/auth.js';
import { KeyPoolManager } from '../services/key-pool.js';
import { getDatabase } from '../db/database.js';
import type { UsageInfo } from '../types/index.js';

const keyPoolManager = new KeyPoolManager();

/**
 * Mask an API key ID — show only last 4 characters.
 */
function maskKeyId(keyId: string): string {
  if (keyId.length <= 4) return keyId;
  return '***' + keyId.slice(-4);
}

/**
 * Look up the default provider from the database.
 */
function resolveProvider(model?: string): { id: string; apiBaseUrl: string } | null {
  const db = getDatabase();

  // Try to match model name to a provider by checking if the model name
  // starts with or contains the provider id (case-insensitive)
  if (model) {
    const modelLower = model.toLowerCase();
    const providers = db.prepare(
      'SELECT id, api_base_url FROM providers',
    ).all() as Record<string, unknown>[];

    for (const p of providers) {
      const pid = (p.id as string).toLowerCase();
      if (modelLower.startsWith(pid) || modelLower.includes(pid)) {
        return { id: p.id as string, apiBaseUrl: p.api_base_url as string };
      }
    }
  }

  // Fallback: use the default provider
  const row = db.prepare(
    'SELECT id, api_base_url FROM providers WHERE is_default = 1 LIMIT 1',
  ).get() as Record<string, unknown> | undefined;

  if (row) {
    return { id: row.id as string, apiBaseUrl: row.api_base_url as string };
  }

  // Fallback: pick the first provider
  const fallback = db.prepare(
    'SELECT id, api_base_url FROM providers LIMIT 1',
  ).get() as Record<string, unknown> | undefined;

  if (fallback) {
    return { id: fallback.id as string, apiBaseUrl: fallback.api_base_url as string };
  }

  return null;
}

/**
 * Extract usage info from a non-streaming Anthropic messages response.
 * Anthropic format: { usage: { input_tokens, output_tokens } }
 */
function extractUsageFromResponse(body: Record<string, unknown>): UsageInfo {
  const usage = body.usage as Record<string, number> | undefined;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Record token usage into the database.
 */
function recordUsage(
  userId: string,
  providerId: string,
  apiKeyId: string,
  model: string,
  usage: UsageInfo,
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO token_usage (user_id, provider_id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, providerId, apiKeyId, model, usage.promptTokens, usage.completionTokens, usage.totalTokens);
}

/**
 * Forward a non-streaming request to the upstream Anthropic-compatible provider.
 * Uses x-api-key header and anthropic-version header.
 */
async function forwardNonStreaming(
  providerBaseUrl: string,
  apiKey: string,
  body: unknown,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const url = `${providerBaseUrl}/v1/messages`;

  const response = await undiciRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await response.body.json() as Record<string, unknown>;
  return { statusCode: response.statusCode, body: responseBody };
}

/**
 * Forward a streaming request to the upstream Anthropic-compatible provider.
 * Anthropic streaming uses SSE events: message_start, content_block_delta, message_delta.
 * Usage info comes in the message_delta event.
 */
async function forwardStreaming(
  providerBaseUrl: string,
  apiKey: string,
  body: unknown,
  reply: FastifyReply,
): Promise<UsageInfo> {
  const url = `${providerBaseUrl}/v1/messages`;

  const response = await undiciRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  // If upstream returned an error, send it back
  if (response.statusCode >= 400) {
    const errorBody = await response.body.text();
    reply.code(response.statusCode).send(errorBody);
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let usage: UsageInfo = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let buffer = '';

  for await (const chunk of response.body) {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    buffer += text;

    // Forward the raw chunk to the client
    reply.raw.write(text);

    // Try to extract usage from SSE data lines
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          // Anthropic sends usage in message_start (input_tokens) and message_delta (output_tokens)
          if (data.type === 'message_start') {
            const message = data.message as Record<string, unknown> | undefined;
            if (message?.usage) {
              const u = message.usage as Record<string, number>;
              usage.promptTokens = u.input_tokens ?? 0;
            }
          }
          if (data.type === 'message_delta') {
            const deltaUsage = data.usage as Record<string, number> | undefined;
            if (deltaUsage) {
              usage.completionTokens = deltaUsage.output_tokens ?? 0;
              usage.totalTokens = usage.promptTokens + usage.completionTokens;
            }
          }
        } catch {
          // Ignore parse errors for partial chunks
        }
      }
    }
  }

  reply.raw.end();
  return usage;
}

/**
 * Fastify plugin that registers Anthropic-compatible proxy routes.
 * Routes:
 *   POST /anthropic/v1/messages — proxy messages
 */
export async function anthropicRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /anthropic/v1/messages
  fastify.post(
    '/anthropic/v1/messages',
    { preHandler: authMiddleware },
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { model, messages, stream, tools, max_tokens, ...rest } = body as {
        model?: string;
        messages?: unknown;
        stream?: boolean;
        tools?: unknown;
        max_tokens?: number;
        [key: string]: unknown;
      };

      if (!model || typeof model !== 'string') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'model is required and must be a string',
        });
      }

      if (!messages || !Array.isArray(messages)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'messages is required and must be an array',
        });
      }

      const userId = request.user!.id;

      // Resolve provider
      const provider = resolveProvider(model);
      if (!provider) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'No provider configured',
        });
      }

      // Check provider access
      const user = request.user!;
      if (user.allowedProviders && !user.allowedProviders.includes(provider.id)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: `Access to provider '${provider.id}' is not allowed`,
        });
      }

      // Get next available key
      const encryptionKey = process.env.ENCRYPTION_KEY ?? '';
      keyPoolManager.loadActiveKeys();
      const keyEntry = keyPoolManager.getNextKey(provider.id, encryptionKey);

      if (!keyEntry) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: `No available API keys for provider '${provider.id}'`,
        });
      }

      // Build the upstream request body (pass through all fields)
      const upstreamBody = { model, messages, stream: stream ?? false, ...rest } as Record<string, unknown>;
      if (tools !== undefined) upstreamBody.tools = tools;
      if (max_tokens !== undefined) upstreamBody.max_tokens = max_tokens;

      // Set response headers
      reply.header('X-Provider', provider.id);
      reply.header('X-Key-Id', maskKeyId(keyEntry.id));

      try {
        if (stream) {
          // Streaming response
          const usage = await forwardStreaming(
            provider.apiBaseUrl,
            keyEntry.key,
            upstreamBody,
            reply,
          );

          // Record usage
          if (usage.totalTokens > 0) {
            recordUsage(userId, provider.id, keyEntry.id, model, usage);
          }

          keyPoolManager.markKeySuccess(keyEntry.id);
          return; // Already sent via raw stream
        }

        // Non-streaming response
        const result = await forwardNonStreaming(
          provider.apiBaseUrl,
          keyEntry.key,
          upstreamBody,
        );

        // Handle upstream errors that indicate key issues
        if (result.statusCode === 429 || result.statusCode === 402) {
          keyPoolManager.markKeyFailure(keyEntry.id);
          return reply.code(result.statusCode).send(result.body);
        }

        if (result.statusCode >= 400) {
          return reply.code(result.statusCode).send(result.body);
        }

        // Extract and record usage
        const usage = extractUsageFromResponse(result.body);
        if (usage.totalTokens > 0) {
          recordUsage(userId, provider.id, keyEntry.id, model, usage);
        }

        keyPoolManager.markKeySuccess(keyEntry.id);
        return reply.code(result.statusCode).send(result.body);
      } catch (err: unknown) {
        keyPoolManager.markKeyFailure(keyEntry.id);
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.code(502).send({
          error: 'Bad Gateway',
          message: `Failed to forward request to provider: ${message}`,
        });
      }
    },
  );
}
