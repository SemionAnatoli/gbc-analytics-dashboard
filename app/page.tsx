export const dynamic = 'force-dynamic'

import DashboardApp from '@/components/DashboardApp'
import { getOrdersWithMeta } from '@/lib/data'

export default async function DashboardPage() {
  const initial = await getOrdersWithMeta()

  return <DashboardApp initial={initial} />
}
