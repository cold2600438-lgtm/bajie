import type {
  UserInfo,
  RegisterInput,
  RegisterResult,
  UsageSummary,
  UsageQueryParams,
  AdminCreateUserInput,
  ApiKeyInfo,
  AddKeyInput,
  UpdateKeyInput,
  ProviderInfo,
  PricingInput,
  CostReport,
  TimeRange,
  HealthStatus,
} from '../types'

// ============================================================
// API Client — 封装 fetch，自动注入 Token，统一错误处理
// ============================================================

const TOKEN_KEY = 'access_token'

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export { ApiError }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(path, { ...options, headers })
  } catch {
    throw new ApiError('无法连接服务器', 0)
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken()
      window.location.href = '/login'
      throw new ApiError('未授权，请重新登录', 401)
    }
    if (response.status === 429) {
      throw new ApiError('请求过于频繁', 429)
    }
    if (response.status >= 500) {
      throw new ApiError('服务器错误', response.status)
    }
    // Other 4xx errors — try to extract message from body
    let message = `请求失败 (${response.status})`
    try {
      const body = await response.json()
      if (body.message) message = body.message
      else if (body.error) message = body.error
    } catch {
      // ignore parse errors
    }
    throw new ApiError(message, response.status)
  }

  // 204 No Content or empty body
  const text = await response.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}


// ============================================================
// Auth API
// ============================================================

export async function login(token: string): Promise<UserInfo> {
  setStoredToken(token)
  try {
    const user = await getUserProfile()
    return user
  } catch (err) {
    clearStoredToken()
    throw err
  }
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  return request<RegisterResult>('/api/user/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function resetToken(): Promise<{ accessToken: string }> {
  return request<{ accessToken: string }>('/api/user/reset-token', {
    method: 'POST',
  })
}

// ============================================================
// User API
// ============================================================

export async function getUserUsage(params?: UsageQueryParams): Promise<UsageSummary[]> {
  const query = new URLSearchParams()
  if (params?.start) query.set('start', params.start)
  if (params?.end) query.set('end', params.end)
  if (params?.granularity) query.set('granularity', params.granularity)
  const qs = query.toString()
  return request<UsageSummary[]>(`/api/user/usage${qs ? `?${qs}` : ''}`)
}

export async function getUserProfile(): Promise<UserInfo> {
  return request<UserInfo>('/api/user/profile')
}

// ============================================================
// Admin — Users
// ============================================================

export async function listUsers(): Promise<UserInfo[]> {
  return request<UserInfo[]>('/api/admin/users')
}

export async function createUser(input: AdminCreateUserInput): Promise<UserInfo> {
  return request<UserInfo>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function disableUser(userId: string): Promise<void> {
  return request<void>(`/api/admin/users/${userId}/disable`, {
    method: 'PUT',
  })
}

export async function deleteUser(userId: string): Promise<void> {
  return request<void>(`/api/admin/users/${userId}`, {
    method: 'DELETE',
  })
}

export async function setUserProviders(userId: string, providers: string[]): Promise<void> {
  return request<void>(`/api/admin/users/${userId}/providers`, {
    method: 'PUT',
    body: JSON.stringify({ providers }),
  })
}

export async function adminResetToken(userId: string): Promise<{ accessToken: string }> {
  return request<{ accessToken: string }>(`/api/admin/users/${userId}/reset-token`, {
    method: 'POST',
  })
}

// ============================================================
// Admin — Keys
// ============================================================

export async function listKeys(): Promise<ApiKeyInfo[]> {
  return request<ApiKeyInfo[]>('/api/admin/keys')
}

export async function addKey(input: AddKeyInput): Promise<ApiKeyInfo> {
  return request<ApiKeyInfo>('/api/admin/keys', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function removeKey(keyId: string): Promise<void> {
  return request<void>(`/api/admin/keys/${keyId}`, {
    method: 'DELETE',
  })
}

export async function updateKey(keyId: string, input: UpdateKeyInput): Promise<void> {
  return request<void>(`/api/admin/keys/${keyId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

// ============================================================
// Admin — Providers
// ============================================================

export async function listProviders(): Promise<ProviderInfo[]> {
  return request<ProviderInfo[]>('/api/admin/providers')
}

export async function updatePricing(providerId: string, pricing: PricingInput): Promise<void> {
  return request<void>(`/api/admin/providers/${providerId}/pricing`, {
    method: 'PUT',
    body: JSON.stringify(pricing),
  })
}

// ============================================================
// Admin — Usage & Cost
// ============================================================

export async function getAllUsage(params?: UsageQueryParams): Promise<UsageSummary[]> {
  const query = new URLSearchParams()
  if (params?.start) query.set('start', params.start)
  if (params?.end) query.set('end', params.end)
  if (params?.granularity) query.set('granularity', params.granularity)
  const qs = query.toString()
  return request<UsageSummary[]>(`/api/admin/usage${qs ? `?${qs}` : ''}`)
}

export async function generateCostReport(timeRange: TimeRange): Promise<CostReport> {
  return request<CostReport>('/api/admin/reports/cost', {
    method: 'POST',
    body: JSON.stringify(timeRange),
  })
}

// ============================================================
// Health
// ============================================================

export async function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/health')
}
