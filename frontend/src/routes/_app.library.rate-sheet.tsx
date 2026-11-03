import { createFileRoute, Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { changedCount, useRateSheets, validateRateSheetSearch } from '@/components/library/rate-sheet-data'
import { RateSheetHistory } from '@/components/library/rate-sheet-history'
import { RateSheetTable } from '@/components/library/rate-sheet-table'
import { PersonAvatar } from '@/components/materials/material-meta'
import { useViewer } from '@/lib/session'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/i18n/format'

export const Route = createFileRoute('/_app/library/rate-sheet')({
  validateSearch: validateRateSheetSearch,
  component: RateSheetTab,
})

/** The rate sheet (PRD F8): current rates, fees and terms by product, and the uploads that came before. */
function RateSheetTab() {
  const viewer = useViewer()
  const { t } = useTranslation()
  const { sheet: sheetId } = Route.useSearch()
  const sheets = useRateSheets()
  // R3: only Managers and Admins upload a new sheet.
  const canEdit = viewer.role === 'manager' || viewer.role === 'admin'

  if (sheets.isPending) return <RateSheetSkeleton />
  if (sheets.isError || !sheets.data.length) return <p className="text-muted-foreground">{t('rateSheet.loadError')}</p>

  const all = sheets.data
  // An unknown sheet in the URL falls back to the current one.
  const index = Math.max(0, all.findIndex((s) => s.id === sheetId))
  const sheet = all[index]
  const previous = all[index + 1]
  const count = changedCount(all, index)

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <Trans
            i18nKey="rateSheet.meta"
            values={{ date: formatDate(sheet.effectiveDate), name: sheet.uploadedBy, file: sheet.file }}
            components={{
              date: <time dateTime={sheet.effectiveDate} className="font-medium" />,
              avatar: <PersonAvatar name={sheet.uploadedBy} className="size-5 text-[8px]" />,
              person: <span className="font-medium" />,
              file: <span className="text-muted-foreground" />,
            }}
          />
        </p>
        {index > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('rateSheet.replaced', { date: formatDate(all[index - 1].effectiveDate) })}{' '}
            <Link to="/library/rate-sheet" className="text-primary hover:underline">{t('rateSheet.viewCurrent')}</Link>
          </p>
        )}
        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('rateSheet.readOnly')}
          </p>
        )}
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_16rem] xl:gap-10">
        <section className="grid min-w-0 content-start gap-3">
          {previous && count > 0 && (
            <p className="max-w-3xl text-sm">
              {t('rateSheet.changes.summary', { count, date: formatDate(previous.effectiveDate) })}{' '}
              <span className="text-muted-foreground">{t('rateSheet.changes.reReview')}</span>{' '}
              <Link to="/library/rules/$ruleId" params={{ ruleId: 'RATE-01' }} className="text-primary hover:underline">
                {t('rateSheet.changes.rule')}
              </Link>
            </p>
          )}
          <RateSheetTable sheets={all} index={index} />
          <p className="text-xs text-muted-foreground">{t('rateSheet.footnote')}</p>
        </section>

        <aside className="grid content-start gap-2 xl:sticky xl:top-16">
          <SectionHeading>{t('rateSheet.history.heading')}</SectionHeading>
          <RateSheetHistory sheets={all} index={index} />
        </aside>
      </div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
}

function RateSheetSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-3 w-64" />
      <Skeleton className="mt-4 h-96 w-full" />
    </div>
  )
}
