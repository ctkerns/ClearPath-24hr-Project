import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PersonAvatar } from '@/components/materials/material-meta'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/utils'
import { changedCount, type RateSheet } from './rate-sheet-data'

/** Every uploaded sheet, newest first, like a document's version history. Picking one shows it in the table. */
export function RateSheetHistory({ sheets, index }: { sheets: RateSheet[]; index: number }) {
  const { t } = useTranslation()
  return (
    <ol className="overflow-hidden rounded-lg border">
      {sheets.map((s, i) => {
        const count = changedCount(sheets, i)
        const selected = i === index
        return (
          <li key={s.id} className="border-b last:border-b-0">
            <Link
              to="/library/rate-sheet"
              // The current sheet has a clean URL; older ones are named in the search.
              search={i === 0 ? {} : { sheet: s.id }}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'grid gap-0.5 border-l-2 border-transparent px-3 py-2 text-sm transition-colors hover:bg-muted/60',
                selected && 'border-primary bg-primary-soft/50 hover:bg-primary-soft/50',
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <time dateTime={s.effectiveDate} className="font-medium tabular-nums">{formatDate(s.effectiveDate)}</time>
                {i === 0 && (
                  <span className="rounded-sm px-1.5 text-[11px] font-medium text-primary-strong shadow-[inset_0_0_0_1px_currentColor]">
                    {t('rateSheet.history.current')}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PersonAvatar name={s.uploadedBy} className="size-4 text-[7px]" />
                <span className="truncate">{s.file}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {i === sheets.length - 1 ? t('rateSheet.history.first') : t('rateSheet.history.changed', { count })}
              </span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
