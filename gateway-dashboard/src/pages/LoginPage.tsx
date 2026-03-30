import { useState, useEffect } from 'react'
import { Card, Form, Input, Button, Typography, App } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const { Title } = Typography

export default function LoginPage() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    if (user) {
      navigate(user.role === 'admin' ? '/admin/users' : '/dashboard', { replace: true })
    }
  }, [user, navigate])

  const onFinish = async (values: { token: string }) => {
    setLoading(true)
    try {
      await login(values.token)
      message.success('登录成功')
    } catch (err: any) {
      message.error(err?.message ?? '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 420 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>AI Token 网关登录</Title>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="token" label="Access Token" rules={[{ required: true, message: '请输入 Access Token' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入 Access Token" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          还没有账号？<Link to="/register">立即注册</Link>
        </div>
      </Card>
    </div>
  )
}
