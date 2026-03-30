import { useState } from 'react'
import { Card, Form, Input, Select, Button, Modal, Typography, App } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { register } from '../api/client'

const { Title } = Typography

const PROVIDER_OPTIONS = [
  { label: 'Kimi (Moonshot)', value: 'kimi' },
  { label: 'MiniMax', value: 'minimax' },
  { label: 'GLM (智谱)', value: 'glm' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
]

export default function RegisterPage() {
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const { message, modal } = App.useApp()

  const onFinish = async (values: { username: string; apiKey?: string; apiKeyProvider?: string }) => {
    setLoading(true)
    try {
      const result = await register({
        username: values.username,
        apiKey: values.apiKey || undefined,
        apiKeyProvider: values.apiKeyProvider || undefined,
      })
      modal.success({
        title: '注册成功',
        content: (
          <div>
            <p>请妥善保存你的 Access Token：</p>
            <Input.TextArea value={result.accessToken} readOnly autoSize style={{ marginBottom: 8 }} />
            {result.apiKeyValid !== undefined && (
              <p>API Key 验证结果：{result.apiKeyValid ? '✅ 有效' : '❌ 无效'}</p>
            )}
          </div>
        ),
        width: 480,
      })
      form.resetFields()
    } catch (err: any) {
      message.error(err?.message ?? '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 480 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>注册新用户</Title>
        <Form form={form} onFinish={onFinish} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key（可选）">
            <Input placeholder="贡献一个 API Key（可选）" />
          </Form.Item>
          <Form.Item name="apiKeyProvider" label="API Key Provider（可选）">
            <Select placeholder="选择 Provider" allowClear options={PROVIDER_OPTIONS} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              注册
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: 'center' }}>
          已有账号？<Link to="/login">返回登录</Link>
        </div>
      </Card>
    </div>
  )
}
