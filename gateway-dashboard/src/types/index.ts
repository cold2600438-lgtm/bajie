// ============================================================
// Frontend Type Definitions for AI Token Gateway Dashboard
// Aligned with backend API responses
// ============================================================

/** 用户信息 */
export interface UserInfo {
  id: string
  username: string
  accessToken: string
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  allowedProviders: string[] | null
  createdAt: string
  updatedAt: string
}

/** 用量汇总 */
export interface UsageSummary {
  userId: string
  provider: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  period: string
}

/** API Key 信息（脱敏） */
export interface ApiKeyInfo {
  id: string
  provider: string
  contributorUserId: string
  status: 'active' | 'disabled' | 'exhausted'
  estimatedQuota: number
  createdAt: string
}

/** Provider 信息 */
export interface ProviderInfo {
  id: string
  name: string
  apiBaseUrl: string
  promptPricePerKToken: number
  completionPricePerKToken: number
  isDefault: boolean
}

/** 费用报告 */
export interface CostReport {
  timeRange: { start: string; end: string }
  entries: CostReportEntry[]
  totalCost: number
}

/** 费用报告条目 */
export interface CostReportEntry {
  userId: string
  provider: string
  promptTokens: number
  completionTokens: number
  promptCost: number
  completionCost: number
  totalCost: number
}

/** 服务健康状态 */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  providers: { provider: string; availableKeys: number; totalKeys: number }[]
}

/** 用户注册输入 */
export interface RegisterInput {
  username: string
  apiKey?: string
  apiKeyProvider?: string
}

/** 用户注册结果 */
export interface RegisterResult {
  userId: string
  accessToken: string
  apiKeyValid?: boolean
}

/** 管理员创建用户输入 */
export interface AdminCreateUserInput {
  username: string
  role?: 'user' | 'admin'
  allowedProviders?: string[]
}

/** 添加 Key 输入 */
export interface AddKeyInput {
  provider: string
  key: string
  contributorUserId: string
  estimatedQuota?: number
}

/** 更新 Key 输入 */
export interface UpdateKeyInput {
  status?: 'active' | 'disabled' | 'exhausted'
  estimatedQuota?: number
}

/** 定价更新输入 */
export interface PricingInput {
  promptPricePerKToken: number
  completionPricePerKToken: number
}

/** 用量查询参数 */
export interface UsageQueryParams {
  start?: string
  end?: string
  granularity?: 'day' | 'week' | 'month'
}

/** 时间范围 */
export interface TimeRange {
  start: string
  end: string
}
