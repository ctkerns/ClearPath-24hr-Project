import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The bordered box around a list, with its loading, error and empty states.
 * Children are the header row and the rows; -mb-px tucks the last row line under the frame border.
 */
export function ListFrame({ status, isEmpty, emptyText, errorText, onClear, children }: {
  status: 'pending' | 'error' | 'success'
  isEmpty: boolean
  emptyText: string
  errorText: string
  onClear: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-lg border">
      {status === 'pending' && <LoadingRows />}
      {status === 'error' && <p className="p-6 text-center text-muted-foreground">{errorText}</p>}
      {status === 'success' && isEmpty && (
        <div className="grid justify-items-center gap-2 p-10 text-center">
          <p className="font-medium">{emptyText}</p>
          <Button variant="outline" size="sm" onClick={onClear}>{t('list.clearAll')}</Button>
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

function LoadingRows() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="flex h-11 items-center gap-3 border-b px-3 last:border-b-0">
      <Skeleton className="size-4" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="size-6 rounded-full" />
    </div>
  ))
}
