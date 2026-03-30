import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type { UserInfo } from '../types'
import {
  login as apiLogin,
  resetToken as apiResetToken,
  getUserProfile,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
} from '../api/client'

// ============================================================
// Auth Context — 管理认证状态，提供 login/logout/resetToken
// ============================================================

interface AuthContextValue {
  token: string | null
  user: UserInfo | null
  isAdmin: boolean
  isLoading: boolean
  login: (token: string) => Promise<void>
  logout: () => void
  resetToken: () => Promise<string>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredToken())
  const [user, setUser] = useState<UserInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isAdmin = user?.role === 'admin'

  // On mount: restore session from localStorage
  useEffect(() => {
    const stored = getStoredToken()
    if (!stored) {
      setIsLoading(false)
      return
    }
    getUserProfile()
      .then((profile) => {
        setUser(profile)
        setToken(stored)
      })
      .catch(() => {
        // Token invalid — clear it
        clearStoredToken()
        setToken(null)
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (accessToken: string) => {
    const profile = await apiLogin(accessToken)
    setToken(accessToken)
    setUser(profile)
  }, [])

  const logout = useCallback(() => {
    clearStoredToken()
    setToken(null)
    setUser(null)
  }, [])

  const resetToken = useCallback(async (): Promise<string> => {
    const { accessToken } = await apiResetToken()
    setStoredToken(accessToken)
    setToken(accessToken)
    // Refresh user profile with new token
    const profile = await getUserProfile()
    setUser(profile)
    return accessToken
  }, [])

  return (
    <AuthContext.Provider
      value={{ token, user, isAdmin, isLoading, login, logout, resetToken }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
