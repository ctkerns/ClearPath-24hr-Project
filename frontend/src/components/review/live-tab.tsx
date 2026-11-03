import { Link } from '@tanstack/react-router'
import { Check, Circle, Pause, Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChannelIcon, LiveStatusTag, PersonAvatar } from '@/components/materials/material-meta'
import type { Material } from '@/components/materials/material-data'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { formatDateTime, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'
import { TrackedFields } from './tracked-text'
import { versionFields, type MaterialDetail } from './material-detail-data'

/**
 * Where the material runs now (PRD F10), and the issues it caused (F12).
 * Each live item compares the live content with the last approved version.
 */
export function LiveTab({ material, detail }: { material: Material; detail: MaterialDetail }) {
  const { t } = useTranslation()
  const approved = [...detail.versions].filter((v) => v.outcome === 'approved').sort((a, b) => b.number - a.number)[0]

  if (detail.live.length === 0 && detail.issues.length === 0) {
    return (
      <div className="grid max-w-xl gap-1.5 rounded-lg border border-dashed p-6">
        <p className="flex items-center gap-2 font-medium"><Radio className="size-4 text-muted-foreground" aria-hidden="true" />{t('review.live.emptyTitle')}</p>
        <p className="text-muted-foreground">{t('review.live.emptyBody')}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-8">
      {detail.issues.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('review.live.issues', { count: detail.issues.length })}</h2>
          {detail.issues.map((issue) => (
            <article key={issue.id} className="grid gap-3 rounded-lg border border-l-[3px] border-l-risk-high p-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="grid content-start gap-1">
                <p className="flex flex-wrap items-center gap-2">
                  <SeverityLabel level={issue.severity} />
                  <Link to="/issues/$issueId" params={{ issueId: issue.id }} className="font-semibold hover:underline">{issue.title}</Link>
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t(`review.live.source.${issue.source}`)} · {formatRelativeTime(issue.openedAt)}</span>
                  <span className="flex items-center gap-1.5"><PersonAvatar name={issue.owner} className="size-4 text-[8px]" />{issue.owner}</span>
                  <span className="font-medium text-risk-medium">{t('review.live.due', { time: formatRelativeTime(issue.dueAt) })}</span>
                </p>
              </div>
              <ul className="grid content-start gap-1 text-xs" aria-label={t('review.live.actions')}>
                {issue.actions.map((a) => (
                  <li key={a.label} className="flex items-start gap-1.5">
                    {a.done
                      ? <Check className="mt-px size-3.5 shrink-0 text-risk-low" strokeWidth={2.5} aria-label={t('review.live.done')} />
                      : <Circle className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-label={t('review.live.todo')} />}
                    <span className={cn(a.done && 'text-muted-foreground')}>{a.label}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}

      {detail.live.map((item) => (
        <section key={item.id} className="grid gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <ChannelIcon channel={material.channel} />
              {item.connector}
              <code className="text-xs font-normal text-muted-foreground">{item.externalId}</code>
            </h2>
            <LiveStatusTag status={item.status} />
            {item.paused && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-neutral-soft px-1.5 py-0.5 text-xs font-semibold text-neutral">
                <Pause className="size-3" aria-hidden="true" />{t('review.live.paused')}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`review.live.match.${item.match}`)} · {t('review.live.found', { date: formatDateTime(item.foundAt) })} · {t('review.live.checked', { time: formatRelativeTime(item.checkedAt) })}
          </p>
          {approved ? (
            <div className="rounded-lg border">
              <p className="border-b bg-muted px-3 py-2 text-xs font-semibold">{t('review.live.changesSince', { version: approved.number })}</p>
              <div className="p-4"><TrackedFields before={versionFields(detail, approved)} after={item.fields} /></div>
            </div>
          ) : (
            <p className="text-muted-foreground">{t('review.live.noApproved')}</p>
          )}
        </section>
      ))}
    </div>
  )
}
