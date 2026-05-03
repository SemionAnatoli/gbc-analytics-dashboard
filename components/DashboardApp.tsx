'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  computeStats,
  computeOrdersByDay,
  computeByCity,
  computeByStatus,
  computeByUtm,
  computeTopProducts,
  computeTopOrders,
  computeWeeklyTrend,
} from '@/lib/analytics'
import {
  OrdersByDayChart,
  RevenueChart,
  MiniBarChart,
  DonutChart,
  CityBars,
  TopProductBars,
} from '@/components/DashboardCharts'
import type { Order } from '@/lib/types'
import type { OrdersResult } from '@/lib/data'

type RangeKey = '7' | '30' | 'all'
type SortKey = 'created_at' | 'total_amount'

interface DashboardAppProps {
  initial: OrdersResult
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  complete: 'Выполнен',
  cancel: 'Отменён',
  assembling: 'Сборка',
  assembled: 'Собран',
  delivery: 'Доставка',
  delivering: 'Доставляется',
}

const STATUS_DOT: Record<string, string> = {
  new: 'bg-blue-400',
  in_progress: 'bg-amber-400',
  complete: 'bg-emerald-400',
  cancel: 'bg-red-400',
  assembling: 'bg-purple-400',
  assembled: 'bg-indigo-400',
  delivery: 'bg-sky-400',
  delivering: 'bg-sky-400',
}

const RANGE_LABEL: Record<RangeKey, string> = {
  '7': '7 дней',
  '30': '30 дней',
  all: 'Всё время',
}

function fmt(n: number) {
  return n.toLocaleString('ru')
}

function money(n: number) {
  return `${fmt(Math.round(n))} ₸`
}

function formatTime(value: string | Date = new Date()) {
  return new Date(value).toLocaleTimeString('ru', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function orderName(order: Order) {
  return `${order.first_name ?? ''} ${order.last_name ?? ''}`.trim() || 'Клиент без имени'
}

function downloadCsv(filename: string, rows: Order[]) {
  const headers = [
    'id',
    'retailcrm_id',
    'client',
    'phone',
    'email',
    'city',
    'status',
    'utm_source',
    'total_amount',
    'items_count',
    'created_at',
  ]

  const escape = (value: unknown) => {
    const text = String(value ?? '')
    return `"${text.replace(/"/g, '""')}"`
  }

  const csv = [
    headers.join(','),
    ...rows.map((order) =>
      [
        order.id,
        order.retailcrm_id,
        orderName(order),
        order.phone,
        order.email,
        order.city,
        STATUS_LABEL[order.status] ?? order.status,
        order.utm_source || 'organic',
        order.total_amount,
        order.items?.length ?? 0,
        order.created_at,
      ]
        .map(escape)
        .join(',')
    ),
  ].join('\n')

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function buildDemoOrder(id: number): Order {
  const cities = ['Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе']
  const sources = ['instagram', 'google', 'organic', 'referral', 'tiktok']
  const products = [
    { productName: 'Premium Shape Set', initialPrice: 42000, quantity: 1 },
    { productName: 'Nova Classic', initialPrice: 15000, quantity: 2 },
    { productName: 'Comfort Body Pro', initialPrice: 68000, quantity: 1 },
  ]
  const item = products[id % products.length]
  const secondItem = id % 2 === 0 ? products[(id + 1) % products.length] : null
  const items = secondItem ? [item, secondItem] : [item]
  const total = items.reduce((sum, orderItem) => sum + orderItem.initialPrice * orderItem.quantity, 0)

  return {
    id,
    retailcrm_id: 99000 + id,
    first_name: ['Диана', 'Мадина', 'Аружан', 'Мария'][id % 4],
    last_name: ['Смагулова', 'Ибраева', 'Ким', 'Петрова'][id % 4],
    phone: `+7700${String(1200000 + id).slice(-7)}`,
    email: `demo${id}@example.com`,
    status: 'new',
    total_amount: total,
    city: cities[id % cities.length],
    utm_source: sources[id % sources.length],
    items,
    created_at: new Date().toISOString(),
    retailcrm_created_at: new Date().toISOString(),
    telegram_notified: false,
  }
}

export default function DashboardApp({ initial }: DashboardAppProps) {
  const router = useRouter()
  const notificationsRef = useRef<HTMLDivElement | null>(null)
  const profileRef = useRef<HTMLDivElement | null>(null)
  const [isPending, startTransition] = useTransition()
  const [orders, setOrders] = useState<Order[]>(initial.orders)
  const [range, setRange] = useState<RangeKey>('all')
  const [city, setCity] = useState('all')
  const [status, setStatus] = useState('all')
  const [source, setSource] = useState('all')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('created_at')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [dismissedAlerts, setDismissedAlerts] = useState<number[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [generatedTime, setGeneratedTime] = useState('--:--')
  const [clock, setClock] = useState('--:--')

  useEffect(() => {
    setOrders(initial.orders)
  }, [initial.orders])

  useEffect(() => {
    setGeneratedTime(formatTime(initial.generatedAt))
    setClock(formatTime())

    const timer = setInterval(() => setClock(formatTime()), 30_000)
    return () => clearInterval(timer)
  }, [initial.generatedAt])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!notificationsOpen && !profileOpen) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return

      if (notificationsOpen && !notificationsRef.current?.contains(target)) {
        setNotificationsOpen(false)
      }

      if (profileOpen && !profileRef.current?.contains(target)) {
        setProfileOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
        setProfileOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [notificationsOpen, profileOpen])

  const rangeOrders = useMemo(() => {
    if (range === 'all') return orders
    const days = Number(range)
    const since = Date.now() - days * 24 * 60 * 60 * 1000
    return orders.filter((order) => new Date(order.created_at).getTime() >= since)
  }, [orders, range])

  const filterOptions = useMemo(() => {
    const cities = Array.from(new Set(orders.map((order) => order.city).filter(Boolean))).sort()
    const statuses = Array.from(new Set(orders.map((order) => order.status).filter(Boolean))).sort()
    const sources = Array.from(new Set(orders.map((order) => order.utm_source || 'organic'))).sort()

    return { cities, statuses, sources }
  }, [orders])

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return rangeOrders
      .filter((order) => city === 'all' || order.city === city)
      .filter((order) => status === 'all' || order.status === status)
      .filter((order) => source === 'all' || (order.utm_source || 'organic') === source)
      .filter((order) => {
        if (!needle) return true
        const haystack = [
          orderName(order),
          order.phone,
          order.email,
          order.city,
          order.utm_source,
          STATUS_LABEL[order.status] ?? order.status,
          ...(order.items ?? []).map((item) => item.productName),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      })
      .sort((a, b) => {
        if (sortBy === 'total_amount') return b.total_amount - a.total_amount
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
  }, [rangeOrders, city, status, source, query, sortBy])

  const stats = useMemo(() => computeStats(filteredOrders), [filteredOrders])
  const allStats = useMemo(() => computeStats(orders), [orders])
  const byDay = useMemo(() => computeOrdersByDay(filteredOrders), [filteredOrders])
  const byCity = useMemo(() => computeByCity(filteredOrders), [filteredOrders])
  const byStatus = useMemo(() => computeByStatus(filteredOrders), [filteredOrders])
  const byUtm = useMemo(() => computeByUtm(filteredOrders), [filteredOrders])
  const topProducts = useMemo(() => computeTopProducts(filteredOrders), [filteredOrders])
  const topOrders = useMemo(() => computeTopOrders(filteredOrders, 3), [filteredOrders])
  const weeklyTrend = useMemo(() => computeWeeklyTrend(orders), [orders])

  const totalOrders = stats.totalOrders || 1
  const almatyPct = Math.round(((byCity.find((item) => item.city === 'Алматы')?.orders ?? 0) / totalOrders) * 100)
  const astanaPct = Math.round(((byCity.find((item) => item.city === 'Астана')?.orders ?? 0) / totalOrders) * 100)
  const highPct = Math.round((stats.highValueOrders / totalOrders) * 100)
  const alerts = useMemo(
    () =>
      orders
        .filter((order) => order.total_amount > 50000)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8),
    [orders]
  )
  const unreadAlerts = alerts.filter((order) => !dismissedAlerts.includes(order.id)).length

  const showToast = (message: string) => setToast(message)

  const resetFilters = () => {
    setRange('all')
    setCity('all')
    setStatus('all')
    setSource('all')
    setQuery('')
    setSortBy('created_at')
    showToast('Фильтры сброшены')
  }

  const refreshData = () => {
    startTransition(() => {
      router.refresh()
    })
    showToast('Данные обновляются с сервера')
  }

  const exportFiltered = () => {
    downloadCsv(`gbc-orders-${new Date().toISOString().slice(0, 10)}.csv`, filteredOrders)
    showToast(`CSV экспортирован: ${filteredOrders.length} заказов`)
  }

  const addDemoOrder = () => {
    const nextOrder = buildDemoOrder(Math.max(0, ...orders.map((order) => order.id)) + 1)
    setOrders((current) => [nextOrder, ...current])
    setRange('all')
    showToast(`Создан демо-заказ на ${money(nextOrder.total_amount)}`)
  }

  const updateOrderStatus = (orderId: number, nextStatus: string) => {
    setOrders((current) =>
      current.map((order) => (order.id === orderId ? { ...order, status: nextStatus } : order))
    )
    setSelectedOrder((current) => (current?.id === orderId ? { ...current, status: nextStatus } : current))
    showToast(`Статус заказа #${orderId} обновлен`)
  }

  const simulateTelegramAlert = (order = alerts[0]) => {
    if (!order) {
      showToast('Нет крупных заказов для уведомления')
      return
    }

    setDismissedAlerts((current) => current.filter((id) => id !== order.id))
    setOrders((current) =>
      current.map((item) => (item.id === order.id ? { ...item, telegram_notified: true } : item))
    )
    showToast(`Telegram-уведомление подготовлено: ${orderName(order)}, ${money(order.total_amount)}`)
  }

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen bg-app-bg">
      {toast && (
        <div className="fixed right-5 top-5 z-50 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-2xl">
          {toast}
        </div>
      )}

      <aside className="fixed left-0 top-0 z-30 flex h-full w-16 flex-col items-center gap-2 bg-sidebar-gradient py-5 shadow-xl">
        <button
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-lg font-black text-white shadow-lg"
          title="GBC Analytics"
          onClick={() => scrollTo('overview')}
        >
          G
        </button>
        {[
          { id: 'overview', label: 'Обзор', icon: '⌂' },
          { id: 'charts', label: 'Графики', icon: '↗' },
          { id: 'traffic', label: 'Маркетинг', icon: '◎' },
          { id: 'orders', label: 'Заказы', icon: '≡' },
          { id: 'automation', label: 'Автоматизация', icon: 'settings' },
        ].map((item) => (
          <button
            key={item.id}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white/70 transition hover:bg-white/15 hover:text-white"
            title={item.label}
            onClick={() => scrollTo(item.id)}
          >
            {item.icon === 'settings' ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.7 1.7 0 0 0 2.5 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.4 1.8 2.9 0 3.4a1.7 1.7 0 0 0-1 2.5c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.5 1c-.5 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.5-1c-1.6.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1.1-2.5c-1.7-.5-1.7-3 0-3.4a1.7 1.7 0 0 0 1.1-2.5c-.9-1.6.8-3.3 2.4-2.4a1.7 1.7 0 0 0 2.5-1Z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            ) : (
              item.icon
            )}
          </button>
        ))}
        <div className="mt-auto">
          <span className="live block h-2 w-2 rounded-full bg-emerald-300" title="Live status" />
        </div>
      </aside>

      <header className="sticky top-0 z-20 ml-16 border-b border-slate-100 bg-white/85 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-slate-800">Аналитика заказов</h1>
              <span
                className={
                  initial.source === 'supabase'
                    ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700'
                    : 'rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700'
                }
              >
                {initial.source === 'supabase' ? 'Live Supabase' : 'Demo-ready'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              RetailCRM · Supabase · Telegram · обновлено {generatedTime}
            </p>
          </div>

          <div className="flex flex-1 items-center justify-end gap-2">
            <label className="hidden min-w-[220px] max-w-sm flex-1 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-500 md:flex">
              <span className="mr-2 text-slate-400">⌕</span>
              <input
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Поиск клиента, города, товара"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="btn-ghost" onClick={refreshData} disabled={isPending}>
              {isPending ? 'Обновляю...' : 'Обновить'}
            </button>
            <button className="btn-primary" onClick={exportFiltered}>
              Экспорт CSV
            </button>

            <div ref={notificationsRef} className="relative">
              <button
                className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                onClick={() => {
                  setNotificationsOpen((value) => !value)
                  setProfileOpen(false)
                }}
                title="Уведомления"
              >
                ⚑
                {unreadAlerts > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-black text-white">
                    {unreadAlerts}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-100 bg-white p-4 shadow-2xl">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-800">Крупные заказы</p>
                      <p className="text-xs text-slate-400">Порог уведомления: 50 000 ₸</p>
                    </div>
                    <button
                      className="text-xs font-semibold text-slate-400 hover:text-slate-700"
                      onClick={() => setDismissedAlerts(alerts.map((order) => order.id))}
                    >
                      Очистить
                    </button>
                  </div>
                  <div className="max-h-80 space-y-2 overflow-auto">
                    {alerts.length ? (
                      alerts.map((order) => (
                        <button
                          key={order.id}
                          className="w-full rounded-xl bg-slate-50 p-3 text-left transition hover:bg-emerald-50"
                          onClick={() => {
                            setSelectedOrder(order)
                            setNotificationsOpen(false)
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-xs font-bold text-slate-700">{orderName(order)}</span>
                            <span className="text-xs font-black text-emerald-600">{money(order.total_amount)}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {order.city} · {order.utm_source || 'organic'} ·{' '}
                            {order.telegram_notified ? 'уведомлен' : 'ждет уведомления'}
                          </p>
                        </button>
                      ))
                    ) : (
                      <p className="py-8 text-center text-sm text-slate-400">Крупных заказов нет</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div ref={profileRef} className="relative">
              <button
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-slate-100"
                onClick={() => {
                  setProfileOpen((value) => !value)
                  setNotificationsOpen(false)
                }}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-gradient text-sm font-bold text-white shadow-md">
                  С
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-xs font-semibold leading-none text-slate-700">Семён Б.</span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">Аналитик</span>
                </span>
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-4 shadow-2xl">
                  <p className="text-sm font-black text-slate-800">Demo workspace</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Работает без приватного доступа к CRM: данные можно фильтровать, экспортировать и менять в демо-сессии.
                  </p>
                  <button
                    className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                    onClick={() => {
                      navigator.clipboard?.writeText(
                        `GBC Analytics: ${orders.length} заказов, ${money(allStats.totalRevenue)} выручки`
                      )
                      showToast('Краткая сводка скопирована')
                    }}
                  >
                    Скопировать сводку
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="ml-16 max-w-[1480px] space-y-5 p-5">
        <section id="overview" className="scroll-mt-20">
          <div className="mb-4 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-card">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-black text-slate-800">
                  {initial.source === 'supabase' ? 'Подключены live-данные Supabase' : 'Включен полноценный demo fallback'}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {initial.notice}. Все ключевые действия доступны: фильтры, экспорт, обновление, локальная смена статуса и симуляция Telegram-уведомлений.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={addDemoOrder}>
                  Добавить демо-заказ
                </button>
                <button className="btn-ghost" onClick={() => simulateTelegramAlert()}>
                  Проверить Telegram
                </button>
                <button className="btn-ghost" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              </div>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-card lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
            <label className="flex rounded-xl bg-white px-3 py-2 text-sm text-slate-500 shadow-sm md:hidden">
              <span className="mr-2 text-slate-400">⌕</span>
              <input
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Поиск"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="flex rounded-xl bg-white p-1 shadow-sm">
              {(Object.keys(RANGE_LABEL) as RangeKey[]).map((key) => (
                <button
                  key={key}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition ${
                    range === key ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                  onClick={() => setRange(key)}
                >
                  {RANGE_LABEL[key]}
                </button>
              ))}
            </div>
            <FilterSelect label="Город" value={city} onChange={setCity} options={filterOptions.cities} />
            <FilterSelect
              label="Статус"
              value={status}
              onChange={setStatus}
              options={filterOptions.statuses}
              getLabel={(value) => STATUS_LABEL[value] ?? value}
            />
            <FilterSelect label="Источник" value={source} onChange={setSource} options={filterOptions.sources} />
            <select
              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm outline-none"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortKey)}
            >
              <option value="created_at">Сначала новые</option>
              <option value="total_amount">Сначала дорогие</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard title="Всего заказов" value={String(stats.totalOrders)} sub={`из ${orders.length} в базе`} icon="□" accent="bg-emerald-50" pct={weeklyTrend.pct} up={weeklyTrend.isUp} />
            <KPICard title="Общая выручка" value={`${fmt(Math.round(stats.totalRevenue / 1000))}K ₸`} sub={money(stats.totalRevenue)} icon="₸" accent="bg-orange-50" pct={8} up />
            <KPICard title="Средний чек" value={money(stats.avgOrderValue)} sub="на один заказ" icon="∑" accent="bg-sky-50" pct={3} up={stats.avgOrderValue >= allStats.avgOrderValue} />
            <KPICard title="Крупных заказов" value={String(stats.highValueOrders)} sub="более 50 000 ₸" icon="★" accent="bg-purple-50" pct={highPct} up />
          </div>
        </section>

        <section id="charts" className="grid scroll-mt-20 grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Заказы по дням</h2>
                <p className="text-xs text-slate-400">Столбцы показывают заказы, линия показывает выручку</p>
              </div>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                {RANGE_LABEL[range]}
              </span>
            </div>
            {filteredOrders.length ? (
              <OrdersByDayChart data={byDay} />
            ) : (
              <EmptyState title="Нет данных для графика" />
            )}
          </div>

          <div className="card flex flex-col justify-between p-5">
            <div>
              <h2 className="mb-1 text-sm font-bold text-slate-800">Охват городов</h2>
              <p className="mb-5 text-xs text-slate-400">Доля заказов по регионам</p>
            </div>
            <div className="mb-5 flex justify-around">
              <CircleProgress pct={almatyPct} color="#3ecf8e" label="Алматы" />
              <CircleProgress pct={astanaPct} color="#0ea5e9" label="Астана" />
              <CircleProgress pct={highPct} color="#f97316" label="> 50K ₸" />
            </div>
            <div className="border-t border-slate-100 pt-4">
              <h3 className="mb-3 text-xs font-semibold text-slate-600">Все города</h3>
              {byCity.length ? <CityBars data={byCity} /> : <EmptyState title="Нет городов" compact />}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-5">
            <p className="mb-0.5 text-xs font-medium text-slate-400">Выручка</p>
            <p className="text-xl font-black text-slate-800">{fmt(Math.round(stats.totalRevenue / 1000))}K ₸</p>
            <p className="mt-1 text-[11px] text-slate-400">Динамика по дням, точка — пик</p>
            <div className="mt-3">{byDay.length ? <RevenueChart data={byDay} /> : <EmptyState title="Нет данных" compact />}</div>
          </div>

          <div className="card p-5">
            <p className="mb-0.5 text-xs font-medium text-slate-400">Последние 7 дней</p>
            <p className="text-xl font-black text-slate-800">{byDay.slice(-7).reduce((sum, item) => sum + item.orders, 0)} заказов</p>
            <p className="mt-1 text-[11px] text-slate-400">Оранжевый столбец — лучший день</p>
            <div className="mt-3">{byDay.length ? <MiniBarChart data={byDay} /> : <EmptyState title="Нет данных" compact />}</div>
          </div>

          <div className="card p-5">
            <p className="mb-0.5 text-xs font-medium text-slate-400">Статусы</p>
            <p className="mb-2 text-xl font-black text-slate-800">{stats.totalOrders} всего</p>
            {byStatus.length ? <DonutChart data={byStatus} total={stats.totalOrders} /> : <EmptyState title="Нет статусов" compact />}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center gap-1.5">
              <span className="text-sm">◆</span>
              <div>
                <p className="text-xs font-bold text-slate-800">Топ заказы</p>
                <p className="text-[10px] text-slate-400">Крупнейшие покупки</p>
              </div>
            </div>
            <div className="space-y-2">
              {topOrders.map((order, index) => (
                <button
                  key={order.id}
                  className="flex w-full items-center gap-3 rounded-xl bg-slate-50 p-3 text-left transition hover:bg-slate-100"
                  onClick={() => setSelectedOrder(order)}
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-xs font-black text-orange-500 shadow-sm">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-700">{orderName(order)}</span>
                    <span className="block text-[11px] text-slate-400">{order.city} · {order.utm_source || 'organic'}</span>
                  </span>
                  <span className="flex-shrink-0 text-sm font-black text-emerald-600">{money(order.total_amount)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="traffic" className="grid scroll-mt-20 grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Источники трафика</h2>
                <p className="text-xs text-slate-400">
                  {source === 'all' ? 'Откуда приходят заказы' : `Фильтр: ${source}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {source !== 'all' && (
                  <button
                    className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-slate-700"
                    onClick={() => setSource('all')}
                  >
                    Все источники
                  </button>
                )}
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                  {stats.totalOrders} заказов
                </span>
              </div>
            </div>
            <div className="space-y-3.5">
              {byUtm.map((item, index) => {
                const colors = ['#3ecf8e', '#0ea5e9', '#f97316', '#8b5cf6', '#ec4899', '#f59e0b']
                const pct = Math.round((item.count / totalOrders) * 100)
                const isSelected = source === item.source
                return (
                  <button
                    key={item.source}
                    className={`block w-full rounded-xl p-2 text-left transition ${
                      isSelected ? 'bg-emerald-50 ring-1 ring-emerald-100' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSource(isSelected ? 'all' : item.source)}
                    title={isSelected ? 'Показать все источники' : 'Отфильтровать по источнику'}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: colors[index % colors.length] }} />
                        <span className="text-xs font-semibold capitalize text-slate-700">{item.source}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">{pct}%</span>
                        <span className="w-5 text-right text-xs font-bold text-slate-800">{item.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[index % colors.length] }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-800">Топ товаров</h2>
              <p className="text-xs text-slate-400">Лидеры продаж по выручке за выбранный период</p>
            </div>
            {topProducts.length ? <TopProductBars data={topProducts} /> : <EmptyState title="Нет товаров" />}
          </div>
        </section>

        <section id="orders" className="card scroll-mt-20 p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Последние заказы</h2>
              <p className="text-xs text-slate-400">Статус можно менять прямо в таблице, строка открывает карточку заказа</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="live h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-slate-400">{clock}</span>
            </div>
          </div>
          {filteredOrders.length ? (
            <OrdersTable
              orders={filteredOrders}
              onOpen={setSelectedOrder}
              onStatusChange={updateOrderStatus}
            />
          ) : (
            <EmptyState title="Заказы не найдены" subtitle="Попробуйте сбросить фильтры или добавить демо-заказ." />
          )}
        </section>

        <section id="automation" className="grid scroll-mt-20 grid-cols-1 gap-5 lg:grid-cols-3">
          <AutomationCard title="RetailCRM" value="API v5" status="Скрипт загрузки и синхронизации готов" />
          <AutomationCard title="Supabase" value="PostgreSQL" status="Server-side чтение, RLS, service-role запись" />
          <AutomationCard title="Telegram Bot" value="> 50 000 ₸" status="Демо-симуляция в UI, реальный бот в scripts/" />
        </section>
      </main>

      <footer className="ml-16 border-t border-slate-100 py-6 text-center text-[11px] text-slate-400">
        GBC Analytics · Next.js 14 · Supabase · Recharts · Vercel-ready
      </footer>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={updateOrderStatus}
          onTelegram={() => simulateTelegramAlert(selectedOrder)}
        />
      )}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  getLabel = (item) => item,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  getLabel?: (value: string) => string
}) {
  return (
    <label className="rounded-xl bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 shadow-sm">
      {label}
      <select
        className="mt-1 block w-full bg-transparent text-xs font-semibold normal-case tracking-normal text-slate-700 outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">Все</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {getLabel(option)}
          </option>
        ))}
      </select>
    </label>
  )
}

function KPICard({
  title,
  value,
  sub,
  icon,
  accent,
  pct,
  up,
}: {
  title: string
  value: string
  sub?: string
  icon: string
  accent: string
  pct?: number
  up?: boolean
}) {
  return (
    <div className="card fade-up p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="mb-3 flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent} text-xl font-black shadow-sm`}>
          {icon}
        </div>
        {pct !== undefined && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
            {up ? '↑' : '↓'} {Math.abs(pct)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-black leading-none text-slate-800">{value}</p>
      <p className="mt-1.5 text-xs font-medium text-slate-500">{title}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function CircleProgress({ pct, color, label }: { pct: number; color: string; label: string }) {
  const r = 28
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-16 w-16">
        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={r} fill="none" stroke="#f1f5f9" strokeWidth="6" />
          <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-slate-700">{pct}%</span>
        </div>
      </div>
      <span className="text-center text-[10px] font-medium leading-tight text-slate-500">{label}</span>
    </div>
  )
}

function OrdersTable({
  orders,
  onOpen,
  onStatusChange,
}: {
  orders: Order[]
  onOpen: (order: Order) => void
  onStatusChange: (orderId: number, status: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            {['', 'Клиент', 'Город', 'Товаров', 'Сумма', 'UTM', 'Статус', ''].map((heading) => (
              <th key={heading} className="pb-3 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.slice(0, 12).map((order, index) => (
            <tr key={order.id} className={`border-b border-slate-50 transition hover:bg-slate-50/80 ${order.total_amount > 50000 ? 'bg-emerald-50/30' : ''}`}>
              <td className="py-3 pr-3 text-xs font-medium text-slate-400">{index + 1}</td>
              <td className="py-3 pr-4">
                <button className="flex items-center gap-2.5 text-left" onClick={() => onOpen(order)}>
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-500 text-xs font-bold text-white">
                    {order.first_name?.[0] ?? '?'}
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-slate-700">{orderName(order)}</span>
                    <span className="block text-[10px] text-slate-400">{order.phone || order.email || '-'}</span>
                  </span>
                </button>
              </td>
              <td className="py-3 pr-4 text-xs text-slate-500">{order.city || '-'}</td>
              <td className="py-3 pr-4 text-xs text-slate-500">{order.items?.length ?? 0}</td>
              <td className="py-3 pr-4">
                <span className="text-sm font-bold text-slate-800">{money(order.total_amount)}</span>
                {order.total_amount > 50000 && <span className="ml-1 text-xs text-amber-500">★</span>}
              </td>
              <td className="py-3 pr-4">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{order.utm_source || 'organic'}</span>
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[order.status] ?? 'bg-slate-300'}`} />
                  <select
                    className="rounded-lg bg-transparent px-1 py-1 text-xs text-slate-600 outline-none hover:bg-white"
                    value={order.status}
                    onChange={(event) => onStatusChange(order.id, event.target.value)}
                  >
                    {Object.entries(STATUS_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </td>
              <td className="py-3 text-right">
                <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white" onClick={() => onOpen(order)}>
                  Открыть
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length > 12 && (
        <p className="pt-3 text-center text-xs text-slate-400">Показано 12 из {orders.length}. Уточните фильтры или экспортируйте CSV.</p>
      )}
    </div>
  )
}

function AutomationCard({ title, value, status }: { title: string; value: string; status: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <p className="mt-1 text-2xl font-black text-slate-800">{value}</p>
      <p className="mt-3 text-xs leading-5 text-slate-500">{status}</p>
    </div>
  )
}

function EmptyState({ title, subtitle, compact = false }: { title: string; subtitle?: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl bg-slate-50 text-center ${compact ? 'min-h-20 p-3' : 'min-h-48 p-8'}`}>
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  )
}

function OrderModal({
  order,
  onClose,
  onStatusChange,
  onTelegram,
}: {
  order: Order
  onClose: () => void
  onStatusChange: (orderId: number, status: string) => void
  onTelegram: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Заказ #{order.retailcrm_id ?? order.id}</p>
            <h3 className="mt-1 text-xl font-black text-slate-800">{orderName(order)}</h3>
            <p className="mt-1 text-sm text-slate-500">{order.phone || order.email || 'Контакт не указан'} · {order.city}</p>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50 p-4">
            <p className="text-[11px] font-bold uppercase text-emerald-700">Сумма</p>
            <p className="mt-1 text-xl font-black text-emerald-700">{money(order.total_amount)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-[11px] font-bold uppercase text-slate-400">Источник</p>
            <p className="mt-1 text-xl font-black text-slate-800">{order.utm_source || 'organic'}</p>
          </div>
          <label className="rounded-xl bg-slate-50 p-4">
            <span className="text-[11px] font-bold uppercase text-slate-400">Статус</span>
            <select
              className="mt-1 block w-full bg-transparent text-base font-black text-slate-800 outline-none"
              value={order.status}
              onChange={(event) => onStatusChange(order.id, event.target.value)}
            >
              {Object.entries(STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-black text-slate-800">Товары</p>
          <div className="space-y-2">
            {(order.items ?? []).map((item, index) => (
              <div key={`${item.productName}-${index}`} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{item.productName}</p>
                  <p className="text-xs text-slate-400">{item.quantity} шт. × {money(item.initialPrice)}</p>
                </div>
                <p className="text-sm font-black text-slate-800">{money(item.initialPrice * item.quantity)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={onTelegram}>
            Симулировать Telegram
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              navigator.clipboard?.writeText(`#${order.retailcrm_id ?? order.id} ${orderName(order)} ${money(order.total_amount)}`)
            }}
          >
            Скопировать ID
          </button>
          <button className="btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}
