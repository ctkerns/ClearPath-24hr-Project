import { Link } from '@tanstack/react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChannelIcon } from '@/components/materials/material-meta'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import type { AffectedMaterial } from './impact-data'

/** Approved materials as links, for a library page's side column (PRD F7). */
export function AffectedList({ materials }: { materials: AffectedMaterial[] }) {
  if (materials.length === 0) return null
  return (
    <ul className="overflow-hidden rounded-lg border">
      {materials.map((m) => (
        <li key={m.id} className="border-b last:border-b-0">
          <Link to="/materials/$materialId" params={{ materialId: m.id }} className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/60">
            <ChannelIcon channel={m.channel} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{m.title}</span>
            <StatusPill status={m.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * In a library change dialog: which approved materials saving flags for re-review, from the server's preview.
 * Saving flags exactly these. The titles are plain text, so the dialog stays open.
 */
export function FlagPreview({ preview }: { preview: UseQueryResult<AffectedMaterial[]> }) {
  const { t } = useTranslation()
  if (preview.isPending && preview.fetchStatus === 'idle') return null // not asked yet, for example no file chosen
  if (preview.isPending) return <Skeleton className="h-12 w-full" />
  if (preview.isError) return <p className="text-xs text-muted-foreground">{t('flags.preview.error')}</p>
  const items = preview.data
  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/40 px-3 py-2.5 text-sm" aria-live="polite">
      <p className="flex items-center gap-2 font-medium">
        <Flag className="size-3.5 shrink-0 text-risk-medium" aria-hidden="true" />
        {t('flags.preview.heading', { count: items.length })}
      </p>
      {items.length > 0 && (
        <ul className="grid max-h-40 gap-1 overflow-y-auto pl-5.5 text-xs">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5">
              <ChannelIcon channel={m.channel} className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{m.title}</span>
              <span className="shrink-0 text-muted-foreground">{t('flags.preview.version', { version: m.version })}</span>
              {m.rates && <span className="shrink-0 text-muted-foreground">· {m.rates.join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('flags.preview.note')}</p>
    </div>
  )
}
