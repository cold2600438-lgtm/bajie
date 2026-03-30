import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, Input, Select, Popconfirm, Space, Tag, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  listUsers, createUser, disableUser, deleteUser,
  adminResetToken, setUserProviders, listProviders,
} from '../api/client'
import type { UserInfo, ProviderInfo } from '../types'

const { Title } = Typography

export default function AdminUsers() {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [providerModalUser, setProviderModalUser] = useState<UserInfo | null>(null)
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [form] = Form.useForm()

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const [u, p] = await Promise.all([listUsers(), listProviders()])
      setUsers(u)
      setProviders(p)
    } catch (err: any) {
      message.error(err?.message ?? '获取用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [])

  const handleCreate = async (values: { username: string; role?: 'user' | 'admin'; allowedProviders?: string[] }) => {
    setCreateLoading(true)
    try {
      const newUser = await createUser(values)
      Modal.success({
        title: '用户创建成功',
        content: (
          <div>
            <p>新用户 Access Token：</p>
            <Input.TextArea value={newUser.accessToken} readOnly autoSize />
          </div>
        ),
        width: 480,
      })
      setCreateOpen(false)
      form.resetFields()
      fetchUsers()
    } catch (err: any) {
      message.error(err?.message ?? '创建用户失败')
    } finally {
      setCreateLoading(false)
    }
  }

  const handleDisable = async (userId: string) => {
    try {
      await disableUser(userId)
      message.success('用户已禁用')
      fetchUsers()
    } catch (err: any) { message.error(err?.message ?? '操作失败') }
  }

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser(userId)
      message.success('用户已删除')
      fetchUsers()
    } catch (err: any) { message.error(err?.message ?? '操作失败') }
  }

  const handleResetToken = async (userId: string) => {
    try {
      const { accessToken } = await adminResetToken(userId)
      Modal.success({
        title: 'Token 已重置',
        content: <Input.TextArea value={accessToken} readOnly autoSize />,
        width: 480,
      })
    } catch (err: any) { message.error(err?.message ?? '重置失败') }
  }

  const handleProviderSave = async () => {
    if (!providerModalUser) return
    try {
      await setUserProviders(providerModalUser.id, selectedProviders)
      message.success('Provider 权限已更新')
      setProviderModalUser(null)
      fetchUsers()
    } catch (err: any) { message.error(err?.message ?? '更新失败') }
  }

  const providerOptions = providers.map((p) => ({ label: p.name, value: p.id }))

  const columns: ColumnsType<UserInfo> = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (r: string) => <Tag color={r === 'admin' ? 'red' : 'blue'}>{r}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s}</Tag> },
    {
      title: 'Provider 权限', dataIndex: 'allowedProviders', key: 'allowedProviders',
      render: (v: string[] | null) => v ? v.join(', ') : '全部',
    },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
    {
      title: '操作', key: 'actions',
      render: (_, record) => (
        <Space size="small" wrap>
          <Popconfirm title="确定禁用该用户？" onConfirm={() => handleDisable(record.id)}>
            <Button size="small">禁用</Button>
          </Popconfirm>
          <Popconfirm title="确定删除该用户？此操作不可恢复。" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
          <Button size="small" onClick={() => handleResetToken(record.id)}>重置Token</Button>
          <Button size="small" onClick={() => {
            setProviderModalUser(record)
            setSelectedProviders(record.allowedProviders ?? [])
          }}>配置Provider权限</Button>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>用户管理</Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>创建用户</Button>
      </div>
      <Table columns={columns} dataSource={users} rowKey="id" loading={loading} />

      <Modal title="创建用户" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null}>
        <Form form={form} onFinish={handleCreate} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="user">
            <Select options={[{ label: 'user', value: 'user' }, { label: 'admin', value: 'admin' }]} />
          </Form.Item>
          <Form.Item name="allowedProviders" label="Provider 权限">
            <Select mode="multiple" options={providerOptions} placeholder="留空表示全部" allowClear />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={createLoading} block>创建</Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="配置 Provider 权限"
        open={!!providerModalUser}
        onCancel={() => setProviderModalUser(null)}
        onOk={handleProviderSave}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={selectedProviders}
          onChange={setSelectedProviders}
          options={providerOptions}
          placeholder="留空表示全部"
          allowClear
        />
      </Modal>
    </div>
  )
}
