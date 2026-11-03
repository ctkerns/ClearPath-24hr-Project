import type { ComponentType, ReactNode } from 'react'

// Shared filter, search and sort model for the list screens.
// All state lives in the URL (?status=open,in_progress&sort=due), so a filtered list can be shared,
// and later saved as a view.
// Materials and Issues filter on the server: their URL search params are the API's query params (serverParams).
// The library and settings lists are small and filter in the browser (applyFilters).

export type FieldIcon = ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>

/**
 * Filter keys map to comma-separated values. q is the text filter. sort is the order.
 * offset is the first row of the page, for the lists that page on the server.
 */
export type ListSearch = { q?: string; sort?: string; offset?: number; [filter: string]: string | number | undefined }

/** What every filter field has. */
export type ListField = {
  key: string
  label: string
  icon: FieldIcon
  /** Plain text for a value, used in the filter chip. */
  optionLabel: (value: string) => string
  /** How a value looks in the menu: the same pill or icon that the rows use. Defaults to the label. */
  renderOption?: (value: string) => ReactNode
}

/** One field of a list that filters in the browser. */
export type FilterField<T> = ListField & {
  /** The values of this field for one item. Some fields have more than one (for example reviewer groups). */
  values: (item: T) => string[]
  /** The values to offer in the menu. */
  options: (items: T[]) => string[]
}

/** One field of a list that filters on the server. The server counts each value (facets). */
export type FacetField = ListField & {
  /** The values to offer even when no item has them (fixed lists from the PRD). Others come from the counts. */
  fixed?: readonly string[]
}

/** Counts per value, per field, from the server: { status: { draft: 3 } }. */
export type Facets = Record<string, Record<string, number>>

/** One value in a filter menu, with how many items have it. */
export type OptionCount = { value: string; count: number }

/** A page of a list that filters on the server. */
export type ListPage<T> = { items: T[]; total: number; facets?: Facets }

/** Rows per page of the lists that page on the server. */
export const PAGE_SIZE = 50

/** A quick view above the list. Each one is only a set of filters. */
export type Preset = { key: string; label: string; filters: Record<string, string> }

export type SortOption = { key: string; label: string }

export const filterValues = (search: ListSearch, key: string) => {
  const value = search[key]
  return typeof value === 'string' ? value.split(',').filter(Boolean) : []
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

/**
 * Keeps only known keys and values, so a bad link shows the plain list instead of an error.
 * `allowed` lists the values of the fixed fields; unknown ones are dropped (the server answers 422 for them).
 */
export function validateListSearch(
  raw: Record<string, unknown>,
  filterKeys: readonly string[],
  sorts: readonly string[],
  allowed: Partial<Record<string, readonly string[]>> = {},
): ListSearch {
  const search: ListSearch = { q: text(raw.q), sort: sorts.includes(raw.sort as string) ? (raw.sort as string) : undefined }
  for (const key of filterKeys) {
    const known = allowed[key]
    const value = text(raw[key])
    search[key] = known && value ? text(value.split(',').filter((v) => known.includes(v)).join(',')) : value
  }
  return search
}

/** For the lists that page on the server: the offset is a whole number of pages. */
export function validatePagedSearch(...args: Parameters<typeof validateListSearch>): ListSearch {
  const search = validateListSearch(...args)
  const offset = Number(args[0].offset)
  if (Number.isInteger(offset) && offset > 0 && offset % PAGE_SIZE === 0) search.offset = offset
  return search
}

/**
 * The API query string for a list that filters on the server. The URL search params go as they are
 * (same names, comma-separated values), with the page size and a request for the facet counts.
 */
export function serverParams(search: ListSearch, filterKeys: readonly string[]) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), facets: 'true' })
  const q = search.q?.trim()
  if (q) params.set('q', q)
  if (search.sort) params.set('sort', search.sort)
  if (search.offset) params.set('offset', String(search.offset))
  for (const key of filterKeys) {
    const values = filterValues(search, key)
    if (values.length) params.set(key, values.join(','))
  }
  return params.toString()
}

/** The search and filters only, without the order and the page: what the regulator export takes. */
export function listFilters(search: ListSearch, filterKeys: readonly string[]) {
  const filters: Record<string, string> = {}
  if (search.q?.trim()) filters.q = search.q.trim()
  for (const key of filterKeys) if (filterValues(search, key).length) filters[key] = filterValues(search, key).join(',')
  return filters
}

/** Menu options for a list that filters in the browser: counted over all items. */
export function countItems<T>(field: FilterField<T>, items: T[]): OptionCount[] {
  return field.options(items).map((value) => ({ value, count: items.filter((item) => field.values(item).includes(value)).length }))
}

/**
 * Menu options for a list that filters on the server: the fixed values, or the values that the server counted,
 * and always the selected ones (a selected value can have no items left).
 */
export function countFacets(field: FacetField, facets: Facets | undefined, selected: string[]): OptionCount[] {
  const counts = facets?.[field.key] ?? {}
  const values = field.fixed ? [...field.fixed] : [...new Set([...Object.keys(counts), ...selected])].sort((a, b) => a.localeCompare(b))
  return values.map((value) => ({ value, count: counts[value] ?? 0 }))
}

export function applyFilters<T>(items: T[], search: ListSearch, fields: FilterField<T>[], searchText: (item: T) => (string | null | undefined)[]) {
  const q = search.q?.trim().toLowerCase()
  return items.filter((item) => {
    for (const field of fields) {
      const wanted = filterValues(search, field.key)
      if (wanted.length && !field.values(item).some((v) => wanted.includes(v))) return false
    }
    return !q || searchText(item).some((v) => v?.toLowerCase().includes(q))
  })
}

export function activePreset(search: ListSearch, presets: Preset[], filterKeys: string[]) {
  return presets.find((p) => filterKeys.every((k) => (search[k] ?? '') === (p.filters[k] ?? '')))?.key
}

/** Removes every filter (and the page) but keeps the text filter and the order. */
export const withoutFilters = (search: ListSearch): ListSearch => ({ q: search.q, sort: search.sort })

/** Classes for one list row link, shared so every list has the same height, hover and focus. */
export const listRowClass =
  'flex h-11 items-center gap-3 px-3 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
