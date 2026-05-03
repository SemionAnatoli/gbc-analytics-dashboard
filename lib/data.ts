import mockOrders from '@/mock_orders.json'
import { createAdminClient } from './supabase'
import type { Order, OrderItem } from './types'

export {
  computeStats,
  computeOrdersByDay,
  computeByCity,
  computeByStatus,
  computeByUtm,
  computeTopProducts,
  computeTopOrders,
  computeWeeklyTrend,
} from './analytics'

type DataSource = 'supabase' | 'demo'

export interface OrdersResult {
  orders: Order[]
  source: DataSource
  notice: string
  generatedAt: string
}

interface RawMockOrder {
  firstName?: string
  lastName?: string
  phone?: string
  email?: string
  status?: string
  items?: OrderItem[]
  delivery?: {
    address?: {
      city?: string
      text?: string
    }
  }
  customFields?: {
    utm_source?: string
  }
}

const REQUEST_TIMEOUT_MS = 6500

export async function getOrders(): Promise<Order[]> {
  const result = await getOrdersWithMeta()
  return result.orders
}

export async function getOrdersWithMeta(): Promise<OrdersResult> {
  const shouldForceDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  if (!shouldForceDemo) {
    const supabase = createAdminClient()

    if (supabase) {
      try {
        const query = supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })

        const { data, error } = await withTimeout(query, REQUEST_TIMEOUT_MS)

        if (error) {
          console.error('Supabase error:', error)
        } else if (data?.length) {
          return {
            orders: data.map(normalizeOrder),
            source: 'supabase',
            notice: 'Live data from Supabase',
            generatedAt: new Date().toISOString(),
          }
        }
      } catch (error) {
        console.error('Supabase request failed, falling back to demo data:', error)
      }
    }
  }

  return {
    orders: getDemoOrders(),
    source: 'demo',
    notice: shouldForceDemo
      ? 'Demo mode is enabled'
      : 'Demo data is shown because live data is unavailable',
    generatedAt: new Date().toISOString(),
  }
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function normalizeOrder(order: Order): Order {
  return {
    ...order,
    total_amount: Number(order.total_amount) || 0,
    items: Array.isArray(order.items) ? order.items.map(normalizeItem) : [],
    created_at: order.created_at ?? new Date().toISOString(),
    retailcrm_created_at: order.retailcrm_created_at ?? null,
    telegram_notified: Boolean(order.telegram_notified),
  }
}

function normalizeItem(item: OrderItem): OrderItem {
  return {
    productName: item.productName || 'Товар',
    quantity: Number(item.quantity) || 1,
    initialPrice: Number(item.initialPrice) || 0,
  }
}

function getDemoOrders(): Order[] {
  const statuses = ['new', 'in_progress', 'assembling', 'delivery', 'complete']
  const now = new Date()

  return (mockOrders as RawMockOrder[]).map((order, index) => {
    const items = (order.items ?? []).map(normalizeItem)
    const created = new Date(now)
    created.setDate(now.getDate() - (index % 21))
    created.setHours(10 + (index % 9), (index * 7) % 60, 0, 0)

    const total = items.reduce(
      (sum, item) => sum + item.initialPrice * item.quantity,
      0
    )

    return {
      id: index + 1,
      retailcrm_id: 90000 + index,
      first_name: order.firstName ?? '',
      last_name: order.lastName ?? '',
      phone: order.phone ?? '',
      email: order.email ?? '',
      status: statuses[index % statuses.length],
      total_amount: total,
      city: order.delivery?.address?.city || 'Неизвестно',
      utm_source: order.customFields?.utm_source ?? 'organic',
      items,
      created_at: created.toISOString(),
      retailcrm_created_at: created.toISOString(),
      telegram_notified: total > 50000 && index % 3 === 0,
    }
  })
}
