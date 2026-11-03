import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, type MaterialStatus } from '@/components/ui/status-pill'
import { formatDate, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'
import {
  CHANNELS,
  LIVE_STATUSES,
  PRODUCTS,
  daysUntil,
  useMaterials,
  type Channel,
  type LiveStatus,
  type Material,
} from '@/components/materials/material-data'
import { ChannelIcon, GroupApprovals, LiveStatusTag, PersonAvatar } from '@/components/materials/material-meta'
import {
  applyFilters,
  sortMaterials,
  validateMaterialsSearch,
  type GroupBy,
  type MaterialsSearch,
} from '@/components/materials/material-filters'
import { MaterialsToolbar } from '@/components/materials/materials-toolbar'
import { useOptionLabel } from '@/components/materials/use-option-label'

export const Route = createFileRoute('/_app/materials/')({
  validateSearch: validateMaterialsSearch,
  component: MaterialsPage,
})

function MaterialsPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const materials = useMaterials()

  // Filters change often, so they replace the history entry instead of adding one.
  const setSearch = (update: (prev: MaterialsSearch) => MaterialsSearch) =>
    void navigate({ search: update, replace: true })

  const all = materials.data ?? []
  const shown = sortMaterials(applyFilters(all, search), search.sort ?? 'updated')
  const groupBy = search.groupBy ?? 'status'

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('page.materials')}</h1>
        {materials.data && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {shown.length === all.length ? all.length : t('materials.countOf', { shown: shown.length, total: all.length })}
          </span>
        )}
        <Button asChild className="ml-auto">
          <Link to="/materials/new"><Plus />{t('page.newMaterial')}</Link>
        </Button>
      </div>

      <MaterialsToolbar materials={all} search={search} setSearch={setSearch} />

      <div className="overflow-hidden rounded-lg border">
        {materials.isPending && <LoadingRows />}
        {materials.isError && <p className="p-6 text-center text-muted-foreground">{t('materials.loadError')}</p>}
        {materials.data && shown.length === 0 && (
          <div className="grid justify-items-center gap-2 p-10 text-center">
            <p className="font-medium">{t('materials.empty')}</p>
            <Button variant="outline" size="sm" onClick={() => setSearch((prev) => ({ groupBy: prev.groupBy, sort: prev.sort }))}>
              {t('materials.clearAll')}
            </Button>
          </div>
        )}
        {shown.length > 0 && (
          // -mb-px tucks the last row line under the frame border.
          <div className="-mb-px"><GroupedList materials={shown} groupBy={groupBy} /></div>
        )}
      </div>
    </div>
  )
}

/** Fixed order for each kind of group, so the list reads the same way every time. */
const groupOrder: Partial<Record<GroupBy, readonly string[]>> = {
  // Work that needs someone comes first, finished work last.
  status: ['submitted', 'in_review', 'changes_requested', 'draft', 'rejected', 'approved', 'live', 'expired', 'retired'] satisfies MaterialStatus[],
  live: LIVE_STATUSES,
  channel: CHANNELS,
  product: PRODUCTS,
}

function groupKey(m: Material, groupBy: GroupBy) {
  switch (groupBy) {
    case 'status': return m.status
    case 'live': return m.liveStatus
    case 'channel': return m.channel
    case 'product': return m.product
    case 'owner': return m.owner
    case 'none': return ''
  }
}

function GroupedList({ materials, groupBy }: { materials: Material[]; groupBy: GroupBy }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  if (groupBy === 'none') return <Rows materials={materials} groupBy={groupBy} />

  const groups = new Map<string, Material[]>()
  for (const m of materials) {
    const key = groupKey(m, groupBy)
    groups.set(key, [...(groups.get(key) ?? []), m])
  }
  const order = groupOrder[groupBy] ?? [...groups.keys()].sort()
  const keys = order.filter((k) => groups.has(k))

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return keys.map((key) => {
    const isOpen = !collapsed.has(`${groupBy}:${key}`)
    const rows = groups.get(key) ?? []
    return (
      <section key={key} aria-label={key}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => toggle(`${groupBy}:${key}`)}
          className="flex h-9 w-full items-center gap-2 border-b bg-muted px-3 text-left hover:bg-border/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')} />
          <GroupLabel groupBy={groupBy} value={key} />
          <span className="text-xs text-muted-foreground tabular-nums">{rows.length}</span>
        </button>
        {isOpen && <Rows materials={rows} groupBy={groupBy} />}
      </section>
    )
  })
}

function GroupLabel({ groupBy, value }: { groupBy: GroupBy; value: string }) {
  const label = useOptionLabel()
  switch (groupBy) {
    case 'status': return <StatusPill status={value as MaterialStatus} />
    case 'live': return <LiveStatusTag status={value as LiveStatus} />
    case 'channel': return <span className="flex items-center gap-2 text-xs font-semibold"><ChannelIcon channel={value as Channel} />{label('channel', value)}</span>
    case 'product': return <span className="text-xs font-semibold">{label('product', value)}</span>
    case 'owner': return <span className="flex items-center gap-2 text-xs font-semibold"><PersonAvatar name={value} className="size-5 text-[9px]" />{value}</span>
    default: return null
  }
}

function Rows({ materials, groupBy }: { materials: Material[]; groupBy: GroupBy }) {
  return (
    <ul>
      {materials.map((m) => (
        <li key={m.id} className="border-b">
          <MaterialRow material={m} groupBy={groupBy} />
        </li>
      ))}
    </ul>
  )
}

/**
 * One material on one line, like a Linear issue row. Left: ID, channel, title. Right: properties.
 * The column that the list is grouped by is left out, because the group header already shows it.
 * Narrow screens drop the less important columns first.
 */
function MaterialRow({ material: m, groupBy }: { material: Material; groupBy: GroupBy }) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const daysLeft = m.expiresAt ? daysUntil(m.expiresAt) : undefined

  return (
    <Link
      to="/materials/$materialId"
      params={{ materialId: m.id }}
      className="flex h-11 items-center gap-3 px-3 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <code className="w-17 shrink-0 text-xs text-muted-foreground max-sm:hidden">{m.id}</code>
      {groupBy !== 'channel' && (
        <span title={label('channel', m.channel)}><ChannelIcon channel={m.channel} /></span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium">{m.title}</span>
        {m.affiliate && (
          <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground max-md:hidden">{m.affiliate}</span>
        )}
      </span>

      <GroupApprovals groups={m.groups} className="w-56 shrink-0 justify-end overflow-hidden max-lg:hidden" />

      {groupBy !== 'live' && (
        <span className="flex w-36 shrink-0 justify-end max-md:hidden">
          {m.liveStatus !== 'not_live' && <LiveStatusTag status={m.liveStatus} />}
        </span>
      )}

      {groupBy !== 'status' && <StatusPill status={m.status} className="max-sm:hidden" />}

      {groupBy !== 'product' && (
        <span className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground max-xl:hidden">{label('product', m.product)}</span>
      )}

      <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums max-sm:hidden">
        {m.expiresAt && daysLeft !== undefined ? (
          <span
            title={t('materials.expiresOn', { date: formatDate(m.expiresAt) })}
            className={cn(daysLeft <= 0 ? 'font-medium text-risk-high' : daysLeft <= 30 && 'font-medium text-risk-medium')}
          >
            {daysLeft <= 0 ? t('materials.expired') : t('materials.expiresShort', { date: formatDate(m.expiresAt, { month: 'short', day: 'numeric' }) })}
          </span>
        ) : (
          <span title={t('materials.updated')}>{formatRelativeTime(m.updatedAt)}</span>
        )}
      </span>

      {groupBy !== 'owner' && <PersonAvatar name={m.owner} />}
    </Link>
  )
}

function LoadingRows() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="flex h-11 items-center gap-3 border-b px-3 last:border-b-0">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="size-6 rounded-full" />
    </div>
  ))
}
