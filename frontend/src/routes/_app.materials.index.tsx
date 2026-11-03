import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ListFrame, ListHeader } from '@/components/list/list-frame'
import { applyFilters, listRowClass, withoutFilters, type ListSearch } from '@/components/list/list-filters'
import { ListToolbar } from '@/components/list/list-toolbar'
import { daysUntil, useMaterials, type Material } from '@/components/materials/material-data'
import { materialSearchText, sortMaterials, validateMaterialsSearch } from '@/components/materials/material-filters'
import { ChannelIcon, GroupApprovals, LiveStatusTag, PersonAvatar } from '@/components/materials/material-meta'
import { useMaterialList } from '@/components/materials/use-material-list'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import { formatDate, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/materials/')({
  validateSearch: validateMaterialsSearch,
  component: MaterialsPage,
})

function MaterialsPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const materials = useMaterials()
  const list = useMaterialList()

  // Filters change often, so they replace the history entry instead of adding one.
  const setSearch = (update: (prev: ListSearch) => ListSearch) => void navigate({ search: update, replace: true })

  const all = materials.data ?? []
  const shown = sortMaterials(applyFilters(all, search, list.fields, materialSearchText), search)

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      {/* No visible heading: the active tab in the top bar already names the page. */}
      <h1 className="sr-only">{t('page.materials')}</h1>

      <ListToolbar
        items={all}
        {...list}
        search={search}
        setSearch={setSearch}
        searchPlaceholder={t('materials.searchPlaceholder')}
        action={
          <Button asChild size="sm" className="h-7 gap-1.5 text-xs">
            <Link to="/materials/new"><Plus className="size-3.5" />{t('page.newMaterial')}</Link>
          </Button>
        }
      />

      <ListFrame
        status={materials.status}
        isEmpty={shown.length === 0}
        emptyText={t('materials.empty')}
        errorText={t('materials.loadError')}
        onClear={() => setSearch((prev) => ({ sort: withoutFilters(prev).sort }))}
      >
        <ListHeader
          columns={[
            { className: col.channel },
            { label: t('materials.column.title'), className: col.title },
            { label: t('materials.column.status'), className: col.status },
            { label: t('materials.column.groups'), className: cn(col.groups, 'block') },
            { label: t('materials.column.live'), className: col.live },
            { label: t('materials.column.approval'), className: col.approval },
            { label: t('materials.column.product'), className: col.product },
            { label: t('materials.column.date'), className: col.date },
            { className: col.owner },
          ]}
        />
        <Rows materials={shown} />
      </ListFrame>
    </div>
  )
}

/**
 * Column widths and breakpoints, shared by the header row and every material row so they always line up.
 * Narrow screens drop the less important columns first.
 */
const col = {
  channel: 'w-4 shrink-0',
  title: 'min-w-0 flex-1',
  status: 'w-32 shrink-0 max-sm:hidden',
  groups: 'w-56 shrink-0 justify-end text-right max-lg:hidden',
  live: 'flex w-36 shrink-0 justify-end text-right max-md:hidden',
  approval: 'w-32 shrink-0 text-right max-lg:hidden',
  product: 'w-28 shrink-0 text-right max-xl:hidden',
  date: 'w-24 shrink-0 text-right max-sm:hidden',
  owner: 'w-6 shrink-0',
}

function Rows({ materials }: { materials: Material[] }) {
  return (
    <ul>
      {materials.map((m) => (
        <li key={m.id} className="border-b">
          <MaterialRow material={m} />
        </li>
      ))}
    </ul>
  )
}

/**
 * One material on one line. Left: channel and title, then status. Right: properties.
 * Narrow screens drop the less important columns first.
 */
function MaterialRow({ material: m }: { material: Material }) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const daysLeft = m.expiresAt ? daysUntil(m.expiresAt) : undefined

  return (
    <Link
      to="/materials/$materialId"
      params={{ materialId: m.id }}
      className={listRowClass}
    >
      <span title={label('channel', m.channel)} className={col.channel}><ChannelIcon channel={m.channel} /></span>
      <span className={cn(col.title, 'flex items-center gap-2')}>
        <span className="truncate font-medium">{m.title}</span>
        {m.affiliate && (
          <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground max-md:hidden">{m.affiliate}</span>
        )}
      </span>

      {/* Status right after the title, in a fixed column so the pills line up. */}
      <span className={col.status}><StatusPill status={m.status} /></span>

      <GroupApprovals groups={m.groups} className={cn(col.groups, 'overflow-hidden')} />

      <span className={col.live}>
        {m.liveStatus !== 'not_live' && <LiveStatusTag status={m.liveStatus} />}
      </span>

      {/* The approval ID is the reference for audits and affiliates (PRD glossary). Only approved versions have one. */}
      <code className={cn(col.approval, 'text-xs text-muted-foreground')}>{m.approvalId}</code>

      <span className={cn(col.product, 'truncate text-xs text-muted-foreground')}>{label('product', m.product)}</span>

      <span className={cn(col.date, 'text-xs text-muted-foreground tabular-nums')}>
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

      <PersonAvatar name={m.owner} className={col.owner} />
    </Link>
  )
}
