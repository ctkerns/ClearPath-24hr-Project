import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import { CHANNELS, PRODUCTS } from '@/components/materials/material-data'
import type { Rule } from './rule-data'

// Rules list configuration: filter keys, sorts and quick views. Labels and menus are in use-rule-list.tsx.

export const RULE_FILTER_KEYS = ['kind', 'severity', 'layer', 'jurisdiction', 'product', 'channel', 'change'] as const
export type RuleFilterKey = (typeof RULE_FILTER_KEYS)[number]

export const RULE_SORTS = ['title', 'effective', 'severity'] as const
export type RuleSort = (typeof RULE_SORTS)[number]

export const validateRulesSearch = (raw: Record<string, unknown>) => validateListSearch(raw, RULE_FILTER_KEYS, RULE_SORTS)

/** A rule with no products or channels applies to all of them, so it matches every product or channel filter. */
export function ruleValues(r: Rule, key: RuleFilterKey): string[] {
  switch (key) {
    case 'kind': return [r.kind]
    case 'severity': return [r.severity]
    case 'layer': return [r.layer]
    case 'jurisdiction': return [r.jurisdiction]
    case 'product': return r.products.length ? r.products : [...PRODUCTS]
    case 'channel': return r.channels.length ? r.channels : [...CHANNELS]
    case 'change': return [r.pendingChange ? 'pending' : 'current']
  }
}

export const ruleSearchText = (r: Rule) => [r.id, r.title, r.text, r.citation?.label]

const severityRank = { high: 0, medium: 1, low: 2 }

export function sortRules(rules: Rule[], search: ListSearch) {
  const list = [...rules]
  switch ((search.sort ?? 'title') as RuleSort) {
    case 'title': return list.sort((a, b) => a.title.localeCompare(b.title))
    case 'effective': return list.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    case 'severity': return list.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.title.localeCompare(b.title))
  }
}

export const RULE_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'regulation', filters: { kind: 'regulation' } },
  { key: 'policy', filters: { kind: 'policy' } },
  { key: 'pending', filters: { change: 'pending' } },
] as const
