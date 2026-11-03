import type { ComponentType, ReactNode } from 'react'

// Shared filter, search and sort model for the list screens (Materials, Issues).
// All state lives in the URL (?status=open,in_progress&sort=due), so a filtered list can be shared,
// and later saved as a view.

export type FieldIcon = ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>

/** Filter keys map to comma-separated values. q is the text filter. sort is the order. */
export type ListSearch = { q?: string; sort?: string; [filter: string]: string | undefined }

/** One field that the list can filter on. */
export type FilterField<T> = {
  key: string
  label: string
  icon: FieldIcon
  /** The values of this field for one item. Some fields have more than one (for example reviewer groups). */
  values: (item: T) => string[]
  /** The values to offer in the menu. */
  options: (items: T[]) => string[]
  /** Plain text for a value, used in the filter chip. */
  optionLabel: (value: string) => string
  /** How a value looks in the menu: the same pill or icon that the rows use. Defaults to the label. */
  renderOption?: (value: string) => ReactNode
}

/** A quick view above the list. Each one is only a set of filters. */
export type Preset = { key: string; label: string; filters: Record<string, string> }

export type SortOption = { key: string; label: string }

export const filterValues = (search: ListSearch, key: string) => search[key]?.split(',').filter(Boolean) ?? []

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

/** Keeps only known keys and values, so a bad link shows the plain list instead of an error. */
export function validateListSearch(raw: Record<string, unknown>, filterKeys: readonly string[], sorts: readonly string[]): ListSearch {
  const search: ListSearch = { q: text(raw.q), sort: sorts.includes(raw.sort as string) ? (raw.sort as string) : undefined }
  for (const key of filterKeys) search[key] = text(raw[key])
  return search
}

export function applyFilters<T>(items: T[], search: ListSearch, fields: FilterField<T>[], searchText: (item: T) => (string | undefined)[]) {
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

/** Removes every filter but keeps the text filter and the order. */
export const withoutFilters = (search: ListSearch): ListSearch => ({ q: search.q, sort: search.sort })

/** Classes for one list row link, shared so every list has the same height, hover and focus. */
export const listRowClass =
  'flex h-11 items-center gap-3 px-3 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
