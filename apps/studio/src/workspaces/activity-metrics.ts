export type AuditEvent = {
  id: string
  project_id?: string
  action: string
  resource: string
  result: string
  time: string | number
}

export function projectAuditEvents(events: AuditEvent[], projectId: string) {
  return events.filter((event) => event.project_id === projectId)
}

/** Last `days` calendar days of event counts (oldest → newest). */
export function activitySeries(events: AuditEvent[], days = 14) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const buckets = new Map<string, { date: Date; events: number; success: number; failure: number }>()
  for (let i = 0; i < days; i++) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const key = date.toISOString().slice(0, 10)
    buckets.set(key, { date, events: 0, success: 0, failure: 0 })
  }
  for (const event of events) {
    const date = new Date(event.time)
    if (Number.isNaN(date.getTime())) continue
    const key = date.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.events += 1
    if (String(event.result).toLowerCase().includes('fail') || event.result === 'error') {
      bucket.failure += 1
    } else {
      bucket.success += 1
    }
  }
  return [...buckets.values()]
}

export function countBy(events: AuditEvent[], key: 'action' | 'resource' | 'result', limit = 8) {
  const counts = new Map<string, number>()
  for (const event of events) {
    const label = String(event[key] || 'unknown')
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, label: name, value }))
}

export function activitySummary(events: AuditEvent[]) {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const last24h = events.filter((event) => now - new Date(event.time).getTime() <= day).length
  const failures = events.filter(
    (event) => String(event.result).toLowerCase().includes('fail') || event.result === 'error',
  ).length
  const actions = new Set(events.map((event) => event.action)).size
  return {
    total: events.length,
    last24h,
    failures,
    successRate: events.length ? Math.round(((events.length - failures) / events.length) * 100) : 100,
    actions,
  }
}
