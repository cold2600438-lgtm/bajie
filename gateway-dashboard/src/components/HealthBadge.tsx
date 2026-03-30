import { useEffect, useState } from 'react'
import { Badge, Tooltip, Space } from 'antd'
import { getHealth } from '../api/client'
import type { HealthStatus } from '../types'

const STATUS_COLOR: Record<string, string> = {
  ok: 'green',
  degraded: 'orange',
  down: 'red',
}

export default function HealthBadge() {
  const [health, setHealth] = useState<HealthStatus | null>(null)

  const fetchHealth = () => {
    getHealth().then(setHealth).catch(() => setHealth(null))
  }

  useEffect(() => {
    fetchHealth()
    const timer = setInterval(fetchHealth, 30_000)
    return () => clearInterval(timer)
  }, [])

  const status = health?.status ?? 'down'
  const color = STATUS_COLOR[status] ?? 'red'

  const tooltipContent = health
    ? health.providers
        .map((p) => `${p.provider}: ${p.availableKeys}/${p.totalKeys} keys`)
        .join('\n')
    : '无法获取状态'

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>}>
      <Space>
        <Badge color={color} />
        <span style={{ fontSize: 13 }}>
          {status === 'ok' ? '服务正常' : status === 'degraded' ? '服务降级' : '服务异常'}
        </span>
      </Space>
    </Tooltip>
  )
}
