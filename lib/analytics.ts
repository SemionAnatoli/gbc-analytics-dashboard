import type {
  Order,
  DashboardStats,
  ChartDataPoint,
  CityData,
  StatusData,
  UtmData,
  TopProduct,
  WeeklyTrend,
} from './types'

export function computeStats(orders: Order[]): DashboardStats {
  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0)
  return {
    totalOrders: orders.length,
    totalRevenue,
    avgOrderValue: orders.length ? Math.round(totalRevenue / orders.length) : 0,
    highValueOrders: orders.filter((o) => Number(o.total_amount) > 50000).length,
  }
}

export function computeOrdersByDay(orders: Order[]): ChartDataPoint[] {
  const map: Record<string, { orders: number; revenue: number; sortKey: number }> = {}

  for (const order of orders) {
    const dateObj = order.created_at ? new Date(order.created_at) : null
    const date = dateObj
      ? dateObj.toLocaleDateString('ru-KZ', {
          day: '2-digit',
          month: '2-digit',
          timeZone: 'Asia/Almaty',
        })
      : 'Неизв.'
    const sortKey = dateObj ? new Date(dateObj.toDateString()).getTime() : 0

    if (!map[date]) map[date] = { orders: 0, revenue: 0, sortKey }
    map[date].orders += 1
    map[date].revenue += Number(order.total_amount) || 0
    map[date].sortKey = sortKey
  }

  return Object.entries(map)
    .map(([date, v]) => ({ date, orders: v.orders, revenue: v.revenue, sortKey: v.sortKey }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...point }) => point)
}

export function computeByCity(orders: Order[]): CityData[] {
  const map: Record<string, { orders: number; revenue: number }> = {}

  for (const order of orders) {
    const city = order.city || 'Неизвестно'
    if (!map[city]) map[city] = { orders: 0, revenue: 0 }
    map[city].orders += 1
    map[city].revenue += Number(order.total_amount) || 0
  }

  return Object.entries(map)
    .map(([city, v]) => ({ city, ...v }))
    .sort((a, b) => b.orders - a.orders)
}

export function computeByStatus(orders: Order[]): StatusData[] {
  const labels: Record<string, string> = {
    new: 'Новый',
    in_progress: 'В работе',
    complete: 'Выполнен',
    cancel: 'Отменён',
    assembling: 'Сборка',
    assembled: 'Собран',
    delivery: 'Доставка',
    delivering: 'Доставляется',
  }
  const map: Record<string, number> = {}

  for (const order of orders) {
    const s = labels[order.status] ?? order.status
    map[s] = (map[s] ?? 0) + 1
  }

  return Object.entries(map)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)
}

export function computeByUtm(orders: Order[]): UtmData[] {
  const map: Record<string, number> = {}

  for (const order of orders) {
    const src = order.utm_source || 'organic'
    map[src] = (map[src] ?? 0) + 1
  }

  return Object.entries(map)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
}

export function computeTopProducts(orders: Order[]): TopProduct[] {
  const map: Record<string, { count: number; revenue: number }> = {}

  for (const order of orders) {
    for (const item of order.items ?? []) {
      const name = item.productName?.trim() || 'Без названия'
      if (!map[name]) map[name] = { count: 0, revenue: 0 }
      map[name].count += item.quantity ?? 1
      map[name].revenue += (Number(item.initialPrice) || 0) * (item.quantity ?? 1)
    }
  }

  return Object.entries(map)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6)
}

export function computeTopOrders(orders: Order[], limit = 3): Order[] {
  return [...orders]
    .sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
    .slice(0, limit)
}

export function computeWeeklyTrend(orders: Order[]): WeeklyTrend {
  const week = 7 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const current = orders.filter(
    (o) => o.created_at && now - new Date(o.created_at).getTime() < week
  ).length
  const previous = orders.filter((o) => {
    if (!o.created_at) return false
    const age = now - new Date(o.created_at).getTime()
    return age >= week && age < 2 * week
  }).length
  const pct =
    previous > 0
      ? Math.round(((current - previous) / previous) * 100)
      : current > 0
      ? 100
      : 0

  return { current, previous, pct, isUp: pct >= 0 }
}
