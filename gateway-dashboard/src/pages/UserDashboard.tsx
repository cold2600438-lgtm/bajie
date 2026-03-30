import { useEffect, useState } from 'react'
import { Table, DatePicker, Select, Button, Popconfirm, Modal, Input, Space, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { getUserUsage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { UsageSummary } from '../types'

const { RangePicker } = DatePicker
const { Title } = Typography

export default function UserDashboard() {
  const { resetToken } = useAuth()
  const [data, setData] = useState<UsageSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [dates, setDates] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [resetting, setResetting] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await getUserUsage({
        start: dates[0].format('YYYY-MM-DD'),
        end: dates[1].format('YYYY-MM-DD'),
        granularity,
      })
      setData(result)
    } catch (err: any) {
      message.error(err?.message ?? '获取用量失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [dates, granularity])

  const handleResetToken = async () => {
    setResetting(true)
    try {
      const newToken = await resetToken()
      Modal.success({
        title: 'Token 已重置',
        content: (
          <div>
            <p>请妥善保存新的 Access Token（旧 Token 已失效）：</p>
            <Input.TextArea value={newToken} readOnly autoSize />
          </div>
        ),
        width: 480,
      })
    } catch (err: any) {
      message.error(err?.message ?? '重置 Token 失败')
    } finally {
      setResetting(false)
    }
  }

  const columns: ColumnsType<UsageSummary> = [
    { title: '时间段', dataIndex: 'period', key: 'period' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider' },
    { title: 'Prompt Tokens', dataIndex: 'promptTokens', key: 'promptTokens', align: 'right' },
    { title: 'Completion Tokens', dataIndex: 'completionTokens', key: 'completionTokens', align: 'right' },
    { title: 'Total Tokens', dataIndex: 'totalTokens', key: 'totalTokens', align: 'right' },
  ]

  return (
    <div>
      <Title level={4}>用量概览</Title>
      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker
          value={dates}
          onChange={(val) => { if (val && val[0] && val[1]) setDates([val[0], val[1]]) }}
        />
        <Select value={granularity} onChange={setGranularity} style={{ width: 120 }}>
          <Select.Option value="day">按天</Select.Option>
          <Select.Option value="week">按周</Select.Option>
          <Select.Option value="month">按月</Select.Option>
        </Select>
        <Popconfirm title="重置后旧 Token 将立即失效，确定重置？" onConfirm={handleResetToken}>
          <Button danger loading={resetting}>重置 Token</Button>
        </Popconfirm>
      </Space>
      <Table
        columns={columns}
        dataSource={data}
        rowKey={(r) => `${r.period}-${r.provider}`}
        loading={loading}
        pagination={false}
      />
    </div>
  )
}
