import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, Popconfirm, Space, Tag, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { listKeys, addKey, removeKey, updateKey, listProviders } from '../api/client'
import type { ApiKeyInfo, ProviderInfo } from '../types'

const { Title } = Typography

const STATUS_COLOR: Record<string, string> = { active: 'green', disabled: 'default', exhausted: 'red' }

export default function AdminKeys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [form] = Form.useForm()

  const fetchData = async () => {
    setLoading(true)
    try {
      const [k, p] = await Promise.all([listKeys(), listProviders()])
      setKeys(k)
      setProviders(p)
    } catch (err: any) {
      message.error(err?.message ?? '获取 Key 列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const handleAdd = async (values: { provider: string; key: string; contributorUserId: string; estimatedQuota?: number }) => {
    setAddLoading(true)
    try {
      await addKey(values)
      message.success('Key 添加成功')
      setAddOpen(false)
      form.resetFields()
      fetchData()
    } catch (err: any) {
      message.error(err?.message ?? '添加 Key 失败')
    } finally {
      setAddLoading(false)
    }
  }

  const handleRemove = async (keyId: string) => {
    try {
      await removeKey(keyId)
      message.success('Key 已移除')
      fetchData()
    } catch (err: any) { message.error(err?.message ?? '移除失败') }
  }

  const handleStatusChange = async (keyId: string, status: 'active' | 'disabled' | 'exhausted') => {
    try {
      await updateKey(keyId, { status })
      message.success('状态已更新')
      fetchData()
    } catch (err: any) { message.error(err?.message ?? '更新失败') }
  }

  const providerOptions = providers.map((p) => ({ label: p.name, value: p.id }))

  const columns: ColumnsType<ApiKeyInfo> = [
    { title: 'ID', dataIndex: 'id', key: 'id', render: (id: string) => id.slice(0, 8) + '...' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider' },
    { title: '贡献者', dataIndex: 'contributorUserId', key: 'contributorUserId' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
    { title: '预估额度', dataIndex: 'estimatedQuota', key: 'estimatedQuota', align: 'right' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt' },
    {
      title: '操作', key: 'actions',
      render: (_, record) => (
        <Space size="small" wrap>
          <Popconfirm title="确定移除该 Key？" onConfirm={() => handleRemove(record.id)}>
            <Button size="small" danger>移除</Button>
          </Popconfirm>
          <Select
            size="small"
            value={record.status}
            style={{ width: 110 }}
            onChange={(val) => handleStatusChange(record.id, val)}
            options={[
              { label: 'active', value: 'active' },
              { label: 'disabled', value: 'disabled' },
              { label: 'exhausted', value: 'exhausted' },
            ]}
          />
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Key 管理</Title>
        <Button type="primary" onClick={() => setAddOpen(true)}>添加 Key</Button>
      </div>
      <Table columns={columns} dataSource={keys} rowKey="id" loading={loading} />

      <Modal title="添加 Key" open={addOpen} onCancel={() => setAddOpen(false)} footer={null}>
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item name="provider" label="Provider" rules={[{ required: true, message: '请选择 Provider' }]}>
            <Select options={providerOptions} placeholder="选择 Provider" />
          </Form.Item>
          <Form.Item name="key" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contributorUserId" label="贡献者用户 ID" rules={[{ required: true, message: '请输入贡献者 ID' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="estimatedQuota" label="预估额度">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={addLoading} block>添加</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
