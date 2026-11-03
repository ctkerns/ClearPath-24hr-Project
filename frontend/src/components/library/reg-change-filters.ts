import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import { PRODUCTS } from '@/components/materials/material-data'
import type { Rule } from './rule-data'
import { affectedRules, type RegChange } from './reg-change-data'

// Regulatory changes list configuration: filter keys, sorts and quick views. Labels and menus are in reg-change-list.tsx.

export const REG_CHANGE_FILTER_KEYS = ['status', 'agency', 'product'] as const
export type RegChangeFilterKey = (typeof REG_CHANGE_FILTER_KEYS)[number]

export const REG_CHANGE_SORTS = ['effective', 'published'] as const
export type RegChangeSort = (typeof REG_CHANGE_SORTS)[number]

export const validateRegChangesSearch = (raw: Record<string, unknown>) => validateListSearch(raw, REG_CHANGE_FILTER_KEYS, REG_CHANGE_SORTS)

/** Products come from the affected rules. A rule with no products applies to all of them. */
export function regChangeValues(c: RegChange, key: RegChangeFilterKey, rules: Rule[]): string[] {
  switch (key) {
    case 'status': return [c.status]
    case 'agency': return [c.agency]
    case 'product': return [...new Set(affectedRules(c, rules).flatMap((r) => (r.products.length ? r.products : [...PRODUCTS])))]
  }
}

export const regChangeSearchText = (c: RegChange) => [c.title, c.summary, c.agency, c.citation.label]

export function sortRegChanges(changes: RegChange[], search: ListSearch) {
  const list = [...changes]
  switch ((search.sort ?? 'effective') as RegChangeSort) {
    // Soonest first: the change that takes effect next is the one to decide next.
    case 'effective': return list.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    case 'published': return list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  }
}

export const REG_CHANGE_PRESETS = [
  { key: 'waiting', filters: { status: 'waiting,in_review' } },
  { key: 'applied', filters: { status: 'applied' } },
  { key: 'dismissed', filters: { status: 'dismissed' } },
  { key: 'all', filters: {} },
] as const
