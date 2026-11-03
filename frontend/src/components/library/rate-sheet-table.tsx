import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { TrackedText } from '@/components/review/tracked-text'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatPercent } from '@/i18n/format'
import { cn } from '@/lib/utils'
import { groupByProduct, isRateChange, rowChanges, rowSource, type RateKind, type RateRow, type RateSheet, type RowChange } from './rate-sheet-data'

/** Mortgage rates go to eighths of a point, so allow three decimals. */
const pct = (v: number) => formatPercent(v, 3)

/**
 * One rate sheet laid out like a published bank rate sheet: a section per product, one line per offer.
 * Rows that changed since the sheet before carry a short note, because materials that quote the old rate need re-review.
 */
export function RateSheetTable({ sheets, index }: { sheets: RateSheet[]; index: number }) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const sheet = sheets[index]
  const previous = sheets[index + 1]

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[38%]">{t('rateSheet.column.offer')}</TableHead>
            <TableHead className="text-right">{t('rateSheet.column.rate')}</TableHead>
            <TableHead>{t('rateSheet.column.fees')}</TableHead>
            <TableHead className="max-md:hidden">{t('rateSheet.column.effective')}</TableHead>
            <TableHead className="max-lg:hidden">{t('rateSheet.column.source')}</TableHead>
          </TableRow>
        </TableHeader>
        {groupByProduct(sheet.rows).map((group) => (
          <TableBody key={group.product} className="border-b last:border-b-0">
            <TableRow className="hover:bg-transparent">
              <th colSpan={5} scope="colgroup" className="bg-muted/40 px-3 pt-3 pb-1.5 text-left text-sm font-semibold">
                {label('product', group.product)}
              </th>
            </TableRow>
            {group.rows.map((row) => {
              const { added, changes } = rowChanges(row, previous)
              const source = rowSource(sheets, index, row)
              const changedRate = changes.some((c) => c.field === 'min' || c.field === 'max')
              const noted = added || changes.length > 0
              return (
                <Fragment key={row.key}>
                  <TableRow className={cn('hover:bg-transparent', noted && 'border-b-0')}>
                    <TableCell className="whitespace-normal">{row.offer}</TableCell>
                    <TableCell className="text-right">
                      <RateValue row={row} highlight={changedRate} />
                    </TableCell>
                    <TableCell className="min-w-48 whitespace-normal text-muted-foreground">{row.fees}</TableCell>
                    <TableCell className="text-muted-foreground max-md:hidden">
                      <time dateTime={source.effectiveDate}>{formatDate(source.effectiveDate)}</time>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-lg:hidden">{source.file}</TableCell>
                  </TableRow>
                  {noted && previous && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="pt-0 pb-2.5 whitespace-normal">
                        <ChangeNote previous={previous} kind={row.rate} added={added} changes={changes} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        ))}
      </Table>
    </div>
  )
}

/** "8.99% – 24.99% APR", or one rate when the range is a single value. */
function RateValue({ row, highlight }: { row: RateRow; highlight: boolean }) {
  const { t } = useTranslation()
  const value = row.min === row.max ? pct(row.min) : t('rateSheet.range', { min: pct(row.min), max: pct(row.max) })
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('font-medium', highlight && 'rounded-[2px] bg-primary-soft px-1 text-primary-strong')}>{value}</span>
      <span className="w-7 text-left text-xs text-muted-foreground">{t(`rateSheet.kind.${row.rate}`)}</span>
    </span>
  )
}

/** Old value struck through, new value in cobalt, like track changes. Changes are neutral, not good or bad. */
function ChangeNote({ previous, kind, added, changes }: { previous: RateSheet; kind: RateKind; added: boolean; changes: RowChange[] }) {
  const { t } = useTranslation()
  const since = formatDate(previous.effectiveDate)
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border-l-2 border-primary bg-primary-soft/40 px-3 py-1.5 text-xs">
      <span className="font-medium text-primary-strong">
        {added ? t('rateSheet.changes.added', { date: since }) : t('rateSheet.changes.since', { date: since })}
      </span>
      {changes.map((c) => (
        <span key={c.field} className="inline-flex items-baseline gap-1.5">
          <span className="text-muted-foreground">{t(`rateSheet.field.${c.field}`, { kind: t(`rateSheet.kind.${kind}`) })}</span>
          {isRateChange(c) ? (
            <>
              <del className="text-muted-foreground decoration-muted-foreground/70">
                <span className="sr-only">{t('review.changes.removed')} </span>{pct(c.before)}
              </del>
              <span aria-hidden="true" className="text-muted-foreground">→</span>
              <ins className="rounded-[2px] bg-primary-soft px-0.5 font-medium text-primary-strong no-underline">
                <span className="sr-only">{t('review.changes.added')} </span>{pct(c.after)}
              </ins>
            </>
          ) : (
            <span><TrackedText before={c.before} after={c.after} /></span>
          )}
        </span>
      ))}
    </p>
  )
}
