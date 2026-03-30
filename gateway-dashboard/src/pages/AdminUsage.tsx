import { useEffect, useState } from 'react'
import { Table, DatePicker, Space, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { getAllUsage } from '../api/client'
import type { UsageSummary } from '../types'

const { RangePicker } = DatePicker
const { Title } = Typography

export default function AdminUsage() {
  const [data, setData] = useState<UsageSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [dates, setDates] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()])

  const fetchData = async () => {
    setLoading(true)
    try {
      const result = await getAllUsage({
        start: dates[0].format('YYYY-MM-DD'),
        end: dates[1].format('YYYY-MM-DD'),
      })
      setData(result)
    } catch (err: any) {
      message.error(err?.message ?? '获取用量失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [dates])

  const columns: ColumnsType<UsageSummary> = [
    { title: '用户 ID', dataIndex: 'userId', key: 'userId' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider' },
    { title: 'Prompt Tokens', dataIndex: 'promptTokens', key: 'promptTokens', align: 'right' },
    { title: 'Completion Tokens', dataIndex: 'completionTokens', key: 'completionTokens', align: 'right' },
    { title: 'Total Tokens', dataIndex: 'totalTokens', key: 'totalTokens', align: 'right' },
    { title: '时间段', dataIndex: 'period', key: 'period' },
  ]

  return (
    <div>
      <Title level={4}>用量查看</Title>
      <Space style={{ marginBottom: 16 }}>
        <RangePicker
          value={dates}
          onChange={(val) => { if (val && val[0] && val[1]) setDates([val[0], val[1]]) }}
        />
      </Space>
      <Table
        columns={columns}
        dataSource={data}
        rowKey={(r) => `${r.userId}-${r.provider}-${r.period}`}
        loading={loading}
        pagination={false}
      />
    </div>
  )
}
