import { Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from './context/AuthContext'
import AppLayout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import UserDashboard from './pages/UserDashboard'
import AdminUsers from './pages/AdminUsers'
import AdminKeys from './pages/AdminKeys'
import AdminProviders from './pages/AdminProviders'
import AdminUsage from './pages/AdminUsage'
import AdminCost from './pages/AdminCost'

function RequireAuth({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: '40vh' }} size="large" />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function RootRedirect() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Spin style={{ display: 'flex', justifyContent: 'center', marginTop: '40vh' }} size="large" />
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === 'admin' ? '/admin/users' : '/dashboard'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<UserDashboard />} />
        <Route path="/admin/users" element={<RequireAuth adminOnly><AdminUsers /></RequireAuth>} />
        <Route path="/admin/keys" element={<RequireAuth adminOnly><AdminKeys /></RequireAuth>} />
        <Route path="/admin/providers" element={<RequireAuth adminOnly><AdminProviders /></RequireAuth>} />
        <Route path="/admin/usage" element={<RequireAuth adminOnly><AdminUsage /></RequireAuth>} />
        <Route path="/admin/cost" element={<RequireAuth adminOnly><AdminCost /></RequireAuth>} />
      </Route>
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
