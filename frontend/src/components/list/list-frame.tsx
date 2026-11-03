import { ChevronLeft, ChevronRight } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LoadError, StaleNotice } from '@/components/load-error'
import { Skeleton } from '@/components/ui/skeleton'

/** The part of a query result that the frame reads. Any useQuery result fits. */
type FrameQuery = { status: 'pending' | 'error' | 'success'; error: unknown; isRefetchError: boolean; refetch: () => Promise<unknown> }

/**
 * The bordered box around a list, with its loading, error and empty states.
 * - Error: says what went wrong (offline, server, no access) and offers Retry. A failed refresh keeps the rows and adds a notice.
 * - Empty with filters on: "No X match these filters" and Clear filters.
 * - Empty with no filters: the first-run state, because a new workspace starts empty (PRD A1). It says what the list
 *   will hold and gives the main action when the role has one.
 * Children are the header row and the rows; -mb-px tucks the last row line under the frame border.
 */
export function ListFrame({ query, isEmpty, filtered, what, emptyText, firstRun, onClear, children }: {
  query: FrameQuery
  isEmpty: boolean
  /** True when a filter or a text search is on. */
  filtered: boolean
  /** The items in a sentence, translated and plural: "materials". */
  what: string
  emptyText: string
  firstRun: { text: string; action?: React.ReactNode }
  onClear: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const { status } = query
  return (
    <div className="overflow-hidden rounded-lg border">
      {status === 'pending' && <LoadingRows />}
      {status === 'error' && <LoadError error={query.error} what={what} onRetry={query.refetch} className="px-6" />}
      {status === 'success' && query.isRefetchError && <StaleNotice onRetry={() => void query.refetch()} />}
      {status === 'success' && isEmpty && filtered && (
        <div className="grid justify-items-center gap-2 p-10 text-center">
          <p className="font-medium">{emptyText}</p>
          <Button variant="outline" size="sm" onClick={onClear}>{t('list.clearFilters')}</Button>
        </div>
      )}
      {status === 'success' && isEmpty && !filtered && (
        <div className="grid justify-items-center gap-3 p-10 text-center">
          <p className="max-w-md text-sm text-muted-foreground">{firstRun.text}</p>
          {firstRun.action}
        </div>
      )}
      {status === 'success' && !isEmpty && <div className="-mb-px">{children}</div>}
    </div>
  )
}

/**
 * Column labels, in the same style as the table header in the design system. Each column passes the
 * same width classes as its row cells, so they line up. Hidden from screen readers: each row is one
 * link whose text already names its values. TODO: add a real table view for auditors.
 */
export function ListHeader({ columns }: { columns: { label?: string; className: string }[] }) {
  return (
    <div aria-hidden="true" className="flex h-8 items-center gap-3 border-b bg-muted px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {columns.map((c, i) => <span key={i} className={c.className}>{c.label}</span>)}
    </div>
  )
}

/**
 * Below a list that pages on the server: how many items match ("132 materials"), which rows show, and
 * Previous and Next. `countText` is the translated count, for example t('materials.count', { count }).
 */
export function ListPager({ total, offset, pageSize, countText, onOffset }: {
  total: number
  offset: number
  pageSize: number
  countText: string
  onOffset: (offset: number) => void
}) {
  const { t } = useTranslation()
  const last = Math.min(offset + pageSize, total)
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-live="polite">{countText}</span>
      {total > pageSize && (
        <nav aria-label={t('list.pages')} className="ml-auto flex items-center gap-1">
          <span className="mr-1 tabular-nums">{t('list.range', { from: offset + 1, to: last, total })}</span>
          <Button variant="outline" size="icon" className="size-7" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - pageSize))}>
            <ChevronLeft className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t('list.previous')}</span>
          </Button>
          <Button variant="outline" size="icon" className="size-7" disabled={last >= total} onClick={() => onOffset(offset + pageSize)}>
            <ChevronRight className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{t('list.next')}</span>
          </Button>
        </nav>
      )}
    </div>
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
