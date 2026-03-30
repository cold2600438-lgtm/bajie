// ============================================================
// Database Schema: SQL statements for all tables and indexes
// ============================================================

export const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  access_token TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  allowed_providers TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export const CREATE_PROVIDERS_TABLE = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  prompt_price_per_k_token REAL DEFAULT 0,
  completion_price_per_k_token REAL DEFAULT 0,
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export const CREATE_API_KEYS_TABLE = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  encrypted_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_tag TEXT NOT NULL,
  contributor_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER DEFAULT 0,
  estimated_quota INTEGER,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export const CREATE_TOKEN_USAGE_TABLE = `
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export const CREATE_REQUEST_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  provider_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

// --- Indexes ---

export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_token_usage_user_created ON token_usage(user_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_token_usage_provider_created ON token_usage(provider_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_request_logs_user_created ON request_logs(user_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_provider_status ON api_keys(provider_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_users_access_token ON users(access_token);`,
];

/** All table creation statements in dependency order */
export const ALL_TABLE_STATEMENTS = [
  CREATE_USERS_TABLE,
  CREATE_PROVIDERS_TABLE,
  CREATE_API_KEYS_TABLE,
  CREATE_TOKEN_USAGE_TABLE,
  CREATE_REQUEST_LOGS_TABLE,
];
