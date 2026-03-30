import { useState } from 'react'
import { Table, DatePicker, Button, Space, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { generateCostReport } from '../api/client'
import type { CostReport, CostReportEntry } from '../types'

const { RangePicker } = DatePicker
const { Title } = Typography

export default function AdminCost() {
  const [report, setReport] = useState<CostReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [dates, setDates] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()])

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const result = await generateCostReport({
        start: dates[0].format('YYYY-MM-DD'),
        end: dates[1].format('YYYY-MM-DD'),
      })
      setReport(result)
      message.success('报告生成成功')
    } catch (err: any) {
      message.error(err?.message ?? '生成报告失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cost-report-${dates[0].format('YYYYMMDD')}-${dates[1].format('YYYYMMDD')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const columns: ColumnsType<CostReportEntry> = [
    { title: '用户 ID', dataIndex: 'userId', key: 'userId' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider' },
    { title: 'Prompt Tokens', dataIndex: 'promptTokens', key: 'promptTokens', align: 'right' },
    { title: 'Completion Tokens', dataIndex: 'completionTokens', key: 'completionTokens', align: 'right' },
    { title: 'Prompt 费用', dataIndex: 'promptCost', key: 'promptCost', align: 'right', render: (v: number) => v?.toFixed(4) },
    { title: 'Completion 费用', dataIndex: 'completionCost', key: 'completionCost', align: 'right', render: (v: number) => v?.toFixed(4) },
    { title: '总费用', dataIndex: 'totalCost', key: 'totalCost', align: 'right', render: (v: number) => v?.toFixed(4) },
  ]

  return (
    <div>
      <Title level={4}>费用报告</Title>
      <Space style={{ marginBottom: 16 }}>
        <RangePicker
          value={dates}
          onChange={(val) => { if (val && val[0] && val[1]) setDates([val[0], val[1]]) }}
        />
        <Button type="primary" onClick={handleGenerate} loading={loading}>生成报告</Button>
        {report && <Button onClick={handleExport}>导出 JSON</Button>}
      </Space>
      {report && (
        <>
          <Table
            columns={columns}
            dataSource={report.entries}
            rowKey={(r) => `${r.userId}-${r.provider}`}
            pagination={false}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6} align="right">
                  <strong>总计</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong>{report.totalCost.toFixed(4)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        </>
      )}
    </div>
  )
}
