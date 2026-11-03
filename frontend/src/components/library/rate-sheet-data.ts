import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Product } from '@/components/materials/material-data'

// Rate sheet (PRD F8). Rule RATE-01 (F7) checks every rate in a material against the current sheet.
// Managers upload a CSV; each upload is a full sheet that replaces the one before it (R3).
// GET and POST /api/library/rate-sheets.

/** Loans and cards quote an APR; savings and certificates quote an APY. */
export type RateKind = 'apr' | 'apy'

export type RateRow = {
  /** Stable across uploads, so a row can be compared with the same offer on an older sheet. */
  key: string
  product: Product
  offer: string
  rate: RateKind
  /** Fractions: 0.0899 is 8.99%. min and max are equal for a single rate. */
  min: number
  max: number
  fees: string
}

export type RateSheet = {
  id: string
  effectiveDate: string
  uploadedAt: string
  uploadedBy: string
  file: string
  rows: RateRow[]
}

export type RowField = 'offer' | 'min' | 'max' | 'fees'

export type RowChange =
  | { field: 'min' | 'max'; before: number; after: number }
  | { field: 'offer' | 'fees'; before: string; after: string }

const FIELDS: RowField[] = ['offer', 'min', 'max', 'fees']

/** Newest sheet first. The first one is the current sheet. */
export function useRateSheets() {
  return useQuery({
    queryKey: ['rate-sheets'],
    queryFn: () => api<RateSheet[]>('GET', '/library/rate-sheets'),
  })
}

/** The columns a rate sheet CSV needs, in this order. min and max are percents, like 8.99. */
export const RATE_CSV_COLUMNS = ['key', 'product', 'offer', 'rate', 'min', 'max', 'fees'] as const

export type RateSheetUpload = { effectiveDate: string; file: string; csv: string }

/**
 * Managers only; the server checks the role and every row of the CSV.
 * Resolves with the new sheet. Rejects with an ApiError, so the dialog can show what went wrong.
 */
export function useUploadRateSheet() {
  const queryClient = useQueryClient()
  return async (upload: RateSheetUpload) => {
    const sheet = await api<RateSheet>('POST', '/library/rate-sheets', upload)
    await queryClient.invalidateQueries({ queryKey: ['rate-sheets'] })
    return sheet
  }
}

/** What changed in one row since the sheet before. `added` means the offer is new on this sheet. */
export function rowChanges(row: RateRow, previous: RateSheet | undefined): { added: boolean; changes: RowChange[] } {
  if (!previous) return { added: false, changes: [] }
  const old = previous.rows.find((r) => r.key === row.key)
  if (!old) return { added: true, changes: [] }
  const changes = FIELDS.filter((f) => old[f] !== row[f]).map((f) => ({ field: f, before: old[f], after: row[f] }) as RowChange)
  return { added: false, changes }
}

/**
 * The oldest upload in an unbroken run where this row had the same values as now.
 * That is when the current terms took effect, and which CSV set them.
 */
export function rowSource(sheets: RateSheet[], index: number, row: RateRow): RateSheet {
  let source = sheets[index]
  for (let i = index + 1; i < sheets.length; i++) {
    const older = sheets[i].rows.find((r) => r.key === row.key)
    if (!older || FIELDS.some((f) => older[f] !== row[f])) break
    source = sheets[i]
  }
  return source
}

/** Rows grouped by product, in the order the CSV lists them. */
export function groupByProduct(rows: RateRow[]) {
  const groups = new Map<Product, RateRow[]>()
  for (const r of rows) groups.set(r.product, [...(groups.get(r.product) ?? []), r])
  return [...groups.entries()].map(([product, items]) => ({ product, rows: items }))
}

export type RateSheetSearch = { sheet?: string }

export function validateRateSheetSearch(search: Record<string, unknown>): RateSheetSearch {
  return typeof search.sheet === 'string' ? { sheet: search.sheet } : {}
}

/** How many offers on this sheet are new or changed since the sheet before. */
export function changedCount(sheets: RateSheet[], index: number) {
  const previous = sheets[index + 1]
  if (!previous) return 0
  return sheets[index].rows.filter((r) => {
    const { added, changes } = rowChanges(r, previous)
    return added || changes.length > 0
  }).length
}

export const isRateChange = (c: RowChange): c is Extract<RowChange, { field: 'min' | 'max' }> => c.field === 'min' || c.field === 'max'
