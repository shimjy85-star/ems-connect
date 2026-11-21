export const koreaDay = (value: Date | string = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(typeof value === 'string' ? new Date(value) : value)

export function tripDayBounds(day: string) {
  const start = new Date(`${day}T00:00:00+09:00`).getTime()
  return { start: new Date(start).toISOString(), end: new Date(start + 86400000).toISOString() }
}

export function tripPage(scheduledAt: string, status: string, today = koreaDay()) {
  if (status === 'completed') return '운행기록조회'
  return koreaDay(scheduledAt) > today ? '명일운행계획' : '금일운행'
}
