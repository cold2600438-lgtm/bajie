// ============================================================
// Core Type Definitions for AI Token Gateway
// ============================================================

// --- Protocol Handlers ---

/** 解析后的代理请求（协议处理器输出） */
export interface ParsedProxyRequest {
  provider: string;        // 目标厂商标识
  model: string;           // 模型名称
  messages: unknown;       // 消息体（透传）
  stream: boolean;         // 是否流式
  tools?: unknown;         // function calling / tool use 参数
  maxTokens?: number;      // 最大 token 数
  rawBody: unknown;        // 原始请求体（用于透传未识别字段）
}

/** 发往上游厂商 API 的请求 */
export interface UpstreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 上游厂商 API 的响应 */
export interface UpstreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown | ReadableStream;
}

/** 解析后的上游响应 */
export interface ParsedProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  usage: UsageInfo;
}

// --- Proxy Engine ---

/** 代理转发结果 */
export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown | ReadableStream;
  usage: UsageInfo;
  actualProvider: string;
  actualKeyId: string;  // 脱敏后的 Key 标识
}

// --- Usage Tracking ---

/** Token 用量信息 */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 用量记录条目 */
export interface UsageEntry {
  userId: string;
  provider: string;
  apiKeyId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: Date;
}

/** 用量汇总 */
export interface UsageSummary {
  userId: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  period: string;  // 如 "2024-01-15", "2024-W03", "2024-01"
}

/** 时间范围 */
export interface TimeRange {
  start: Date;
  end: Date;
}

// --- Key Pool Management ---

/** API Key 条目 */
export interface ApiKeyEntry {
  id: string;
  provider: string;
  encryptedKey: string;     // AES-256-GCM 加密存储
  contributorUserId: string;
  status: 'active' | 'disabled' | 'exhausted';
  consecutiveFailures: number;
  estimatedQuota: number;
  lastUsedAt: Date;
  createdAt: Date;
}

/** 新增 API Key 输入 */
export interface NewApiKeyInput {
  provider: string;
  key: string;              // 明文 Key（存储前加密）
  contributorUserId: string;
  estimatedQuota?: number;
}

/** 加密数据 */
export interface EncryptedData {
  encrypted: string;        // 加密后的密文
  iv: string;               // 初始向量
  tag: string;              // 认证标签
}

/** 健康检查结果 */
export interface HealthCheckResult {
  provider: string;
  recoveredKeys: string[];
  stillUnhealthy: string[];
}

// --- Cost Calculation ---

/** Provider 定价 */
export interface ProviderPricing {
  provider: string;
  promptPricePerKToken: number;    // 每千 prompt token 价格
  completionPricePerKToken: number; // 每千 completion token 价格
}

/** 费用报告 */
export interface CostReport {
  timeRange: TimeRange;
  entries: CostReportEntry[];
  totalCost: number;
}

/** 费用报告条目 */
export interface CostReportEntry {
  userId: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  promptCost: number;
  completionCost: number;
  totalCost: number;
}

// --- User Management ---

/** 用户注册输入 */
export interface RegisterInput {
  username: string;
  apiKey?: string;          // 可选：注册时贡献 API Key
  apiKeyProvider?: string;  // Key 对应的厂商
}

/** 用户注册结果 */
export interface RegisterResult {
  userId: string;
  accessToken: string;      // 生成的访问 Token
  apiKeyValid?: boolean;    // 如果提交了 Key，返回验证结果
}

/** 用户信息 */
export interface UserInfo {
  id: string;
  username: string;
  accessToken: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  allowedProviders: string[] | null;  // null 表示全部允许
  createdAt: Date;
  updatedAt: Date;
}

/** 管理员创建用户输入 */
export interface AdminCreateUserInput {
  username: string;
  role?: 'user' | 'admin';
  allowedProviders?: string[];
}

// --- Rate Limiting ---

/** 限流检查结果 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// --- In-Memory State ---

/** Key 池轮询状态（内存中维护） */
export interface KeyPoolState {
  roundRobinIndex: Map<string, number>;
  activeKeys: Map<string, string[]>;
}

/** 限流计数器状态（内存中维护） */
export interface RateLimitState {
  windows: Map<string, number[]>;
}

// --- Provider Configuration ---

/** Provider 配置 */
export interface ProviderConfig {
  id: string;
  name: string;
  apiBaseUrl: string;
  promptPricePerKToken: number;
  completionPricePerKToken: number;
  isDefault: boolean;
  createdAt: Date;
}

// --- Request Logging ---

/** 请求日志条目 */
export interface RequestLogEntry {
  userId?: string;
  providerId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorMessage?: string;
}

// --- Health Check ---

/** 服务健康状态 */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  providers: ProviderHealthInfo[];
}

/** Provider 健康信息 */
export interface ProviderHealthInfo {
  provider: string;
  availableKeys: number;
  totalKeys: number;
}

// --- Protocol Handler Interface ---

/** 协议处理器接口 */
export interface ProtocolHandler {
  parseRequest(req: unknown): ParsedProxyRequest;
  buildUpstreamRequest(parsed: ParsedProxyRequest, apiKey: string, providerUrl: string): UpstreamRequest;
  parseResponse(res: UpstreamResponse): ParsedProxyResponse;
  handleStream(res: UpstreamResponse, reply: unknown): Promise<UsageInfo>;
}

// --- Application Config ---

/** 应用配置 */
export interface AppConfig {
  port: number;
  databasePath: string;
  encryptionKey: string;
  adminToken: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}
