import { Bot, ClipboardCheck, Lock, Radar, Route as RouteIcon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PersonAvatar } from '@/components/materials/material-meta'
import { formatDateTime } from '@/i18n/format'
import type { MaterialDetail } from './material-detail-data'

/** System authors get an icon instead of initials, so people and automation never look alike. */
const systemActors: Record<string, LucideIcon> = {
  'Rule check': ClipboardCheck,
  'AI reviewer': Bot,
  Routing: RouteIcon,
  Monitoring: Radar,
}

/** The audit log (PRD F2): every event, oldest first, with exact times. Append-only, so there are no edit controls. */
export function HistoryTab({ detail }: { detail: MaterialDetail }) {
  const { t } = useTranslation()
  const events = [...detail.history].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="grid max-w-4xl gap-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5" aria-hidden="true" />
        {t('review.history.note')}
      </p>
      <ol className="overflow-hidden rounded-lg border">
        {events.map((e, i) => {
          const Icon = systemActors[e.actor]
          return (
            <li key={i} className="grid gap-x-3 gap-y-0.5 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[10.5rem_10rem_minmax(0,1fr)] sm:items-center">
              <time dateTime={e.at} className="font-mono text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)}</time>
              <span className="flex items-center gap-2 text-xs font-medium">
                {Icon ? (
                  <span className="grid size-5 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3" aria-hidden="true" />
                  </span>
                ) : (
                  <PersonAvatar name={e.actor} className="size-5 text-[8px]" />
                )}
                {e.actor}
              </span>
              <span>{e.text}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
