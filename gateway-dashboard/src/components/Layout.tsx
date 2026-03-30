import { Layout as AntLayout, Menu, Button, Typography } from 'antd'
import {
  UserOutlined,
  KeyOutlined,
  CloudOutlined,
  BarChartOutlined,
  DollarOutlined,
  DashboardOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import HealthBadge from './HealthBadge'

const { Sider, Header, Content } = AntLayout
const { Text } = Typography

const USER_MENU = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '用量概览' },
]

const ADMIN_MENU = [
  { key: '/admin/users', icon: <UserOutlined />, label: '用户管理' },
  { key: '/admin/keys', icon: <KeyOutlined />, label: 'Key 管理' },
  { key: '/admin/providers', icon: <CloudOutlined />, label: 'Provider 配置' },
  { key: '/admin/usage', icon: <BarChartOutlined />, label: '用量查看' },
  { key: '/admin/cost', icon: <DollarOutlined />, label: '费用报告' },
]

export default function AppLayout() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = isAdmin ? ADMIN_MENU : USER_MENU

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="dark">
        <div style={{ padding: '16px', textAlign: 'center', color: '#fff', fontWeight: 600, fontSize: 16 }}>
          AI Token 网关
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
        <div style={{ position: 'absolute', bottom: 60, left: 0, right: 0, padding: '0 16px' }}>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
            {user?.username} ({user?.role})
          </Text>
        </div>
        <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, padding: '0 16px' }}>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={() => { logout(); navigate('/login') }}
            style={{ color: 'rgba(255,255,255,0.65)', width: '100%', textAlign: 'left' }}
          >
            退出登录
          </Button>
        </div>
      </Sider>
      <AntLayout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <HealthBadge />
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  )
}
