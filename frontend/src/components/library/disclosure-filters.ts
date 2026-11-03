import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import { PRODUCTS } from '@/components/materials/material-data'
import type { Disclosure } from './disclosure-data'

// Disclosures list configuration. Labels and menus are in use-disclosure-list.tsx.

export const DISCLOSURE_FILTER_KEYS = ['product', 'state'] as const
export type DisclosureFilterKey = (typeof DISCLOSURE_FILTER_KEYS)[number]

export const DISCLOSURE_SORTS = ['title', 'effective'] as const
export type DisclosureSort = (typeof DISCLOSURE_SORTS)[number]

export const validateDisclosuresSearch = (raw: Record<string, unknown>) => validateListSearch(raw, DISCLOSURE_FILTER_KEYS, DISCLOSURE_SORTS)

/** A disclosure for every product, or every state, matches every filter value. */
export function disclosureValues(d: Disclosure, key: DisclosureFilterKey): string[] {
  switch (key) {
    case 'product': return d.products.length ? d.products : [...PRODUCTS]
    case 'state': return d.states === 'all' ? ['all'] : d.states
  }
}

export const disclosureSearchText = (d: Disclosure) => [d.title, d.text]

export function sortDisclosures(items: Disclosure[], search: ListSearch) {
  const list = [...items]
  switch ((search.sort ?? 'title') as DisclosureSort) {
    case 'title': return list.sort((a, b) => a.title.localeCompare(b.title))
    case 'effective': return list.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
  }
}

export const DISCLOSURE_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'lending', filters: { product: 'personal_loan,auto_loan,mortgage,heloc' } },
  { key: 'cards', filters: { product: 'credit_card' } },
  { key: 'deposits', filters: { product: 'savings' } },
] as const
