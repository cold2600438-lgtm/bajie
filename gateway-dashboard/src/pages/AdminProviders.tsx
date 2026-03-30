import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, InputNumber, Tag, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { listProviders, updatePricing } from '../api/client'
import type { ProviderInfo } from '../types'

const { Title } = Typography

export default function AdminProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [editProvider, setEditProvider] = useState<ProviderInfo | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [form] = Form.useForm()

  const fetchProviders = async () => {
    setLoading(true)
    try {
      setProviders(await listProviders())
    } catch (err: any) {
      message.error(err?.message ?? '获取 Provider 列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProviders() }, [])

  const handleEdit = (provider: ProviderInfo) => {
    setEditProvider(provider)
    form.setFieldsValue({
      promptPricePerKToken: provider.promptPricePerKToken,
      completionPricePerKToken: provider.completionPricePerKToken,
    })
  }

  const handleSave = async (values: { promptPricePerKToken: number; completionPricePerKToken: number }) => {
    if (!editProvider) return
    setSaveLoading(true)
    try {
      await updatePricing(editProvider.id, values)
      message.success('定价已更新')
      setEditProvider(null)
      fetchProviders()
    } catch (err: any) {
      message.error(err?.message ?? '更新定价失败')
    } finally {
      setSaveLoading(false)
    }
  }

  const columns: ColumnsType<ProviderInfo> = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: 'API Base URL', dataIndex: 'apiBaseUrl', key: 'apiBaseUrl' },
    { title: 'Prompt 单价 (每千Token)', dataIndex: 'promptPricePerKToken', key: 'promptPricePerKToken', align: 'right' },
    { title: 'Completion 单价 (每千Token)', dataIndex: 'completionPricePerKToken', key: 'completionPricePerKToken', align: 'right' },
    { title: '默认', dataIndex: 'isDefault', key: 'isDefault', render: (v: boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag> },
    {
      title: '操作', key: 'actions',
      render: (_, record) => (
        <Button size="small" onClick={() => handleEdit(record)}>编辑定价</Button>
      ),
    },
  ]

  return (
    <div>
      <Title level={4}>Provider 配置</Title>
      <Table columns={columns} dataSource={providers} rowKey="id" loading={loading} />

      <Modal title="编辑定价" open={!!editProvider} onCancel={() => setEditProvider(null)} footer={null}>
        <Form form={form} onFinish={handleSave} layout="vertical">
          <Form.Item name="promptPricePerKToken" label="Prompt 单价 (每千Token)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.001} />
          </Form.Item>
          <Form.Item name="completionPricePerKToken" label="Completion 单价 (每千Token)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.001} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saveLoading} block>保存</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
