import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { formatDate, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'
import {
  daysUntil,
  useMaterials,
  type Material,
} from '@/components/materials/material-data'
import { ChannelIcon, GroupApprovals, LiveStatusTag, PersonAvatar } from '@/components/materials/material-meta'
import {
  applyFilters,
  sortMaterials,
  validateMaterialsSearch,
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

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      {/* No visible heading: the active tab in the top bar already names the page. */}
      <h1 className="sr-only">{t('page.materials')}</h1>

      <MaterialsToolbar
        materials={all}
        search={search}
        setSearch={setSearch}
        action={
          <Button asChild size="sm" className="h-7 gap-1.5 text-xs">
            <Link to="/materials/new"><Plus className="size-3.5" />{t('page.newMaterial')}</Link>
          </Button>
        }
      />

      <div className="overflow-hidden rounded-lg border">
        {materials.isPending && <LoadingRows />}
        {materials.isError && <p className="p-6 text-center text-muted-foreground">{t('materials.loadError')}</p>}
        {materials.data && shown.length === 0 && (
          <div className="grid justify-items-center gap-2 p-10 text-center">
            <p className="font-medium">{t('materials.empty')}</p>
            <Button variant="outline" size="sm" onClick={() => setSearch((prev) => ({ sort: prev.sort }))}>
              {t('materials.clearAll')}
            </Button>
          </div>
        )}
        {shown.length > 0 && (
          // -mb-px tucks the last row line under the frame border.
          <div className="-mb-px"><Rows materials={shown} /></div>
        )}
      </div>
    </div>
  )
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
 * One material on one line. Left: status, channel and title. Right: properties.
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
      className="flex h-11 items-center gap-3 px-3 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      {/* Status first: it is what people scan for in a compliance list. */}
      <span className="w-32 shrink-0 max-sm:hidden"><StatusPill status={m.status} /></span>
      <span title={label('channel', m.channel)}><ChannelIcon channel={m.channel} /></span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium">{m.title}</span>
        {m.affiliate && (
          <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground max-md:hidden">{m.affiliate}</span>
        )}
      </span>

      <GroupApprovals groups={m.groups} className="w-56 shrink-0 justify-end overflow-hidden max-lg:hidden" />

      <span className="flex w-36 shrink-0 justify-end max-md:hidden">
        {m.liveStatus !== 'not_live' && <LiveStatusTag status={m.liveStatus} />}
      </span>

      {/* The approval ID is the reference for audits and affiliates (PRD glossary). Only approved versions have one. */}
      <code className="w-32 shrink-0 text-right text-xs text-muted-foreground max-lg:hidden">{m.approvalId}</code>


      <span className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground max-xl:hidden">{label('product', m.product)}</span>

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

      <PersonAvatar name={m.owner} />
    </Link>
  )
}

function LoadingRows() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="flex h-11 items-center gap-3 border-b px-3 last:border-b-0">
      <Skeleton className="size-4" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="size-6 rounded-full" />
    </div>
  ))
}
