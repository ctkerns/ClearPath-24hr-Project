import { useQuery } from '@tanstack/react-query'
import type { Material } from '@/components/materials/material-data'
import { dependentMaterials, type Rule } from './rule-data'

// Regulatory change queue (PRD F7). A feed connector (compliance.ai, Wolters Kluwer) adds the items;
// that connector is P2 and unverified (F11), so the demo seeds them.
// TODO: replace REG_CHANGES_URL with the real API.
const REG_CHANGES_URL = '/demo/regulatory-changes.json'

export const REG_CHANGE_STATUSES = ['waiting', 'in_review', 'applied', 'dismissed'] as const
export type RegChangeStatus = (typeof REG_CHANGE_STATUSES)[number]

/** The suggested new text for one rule. For applied items, "before" is the text the rule had. */
export type RuleEdit = { ruleId: string; before: string; after: string }

export type RegChange = {
  id: string
  title: string
  summary: string
  source: string
  agency: string
  citation: { label: string; url: string }
  publishedAt: string
  effectiveDate: string
  status: RegChangeStatus
  edits: RuleEdit[]
  /** The Manager who opened it, while it is in review. */
  reviewingBy?: string
  decidedBy?: string
  decidedAt?: string
  decisionNote?: string
}

export function useRegChanges() {
  return useQuery({
    queryKey: ['regulatory-changes'],
    queryFn: async (): Promise<RegChange[]> => {
      const res = await fetch(REG_CHANGES_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).changes
    },
    staleTime: Infinity,
  })
}

/** Not decided yet: new, or opened by a Manager. */
export const isUndecided = (c: RegChange) => c.status === 'waiting' || c.status === 'in_review'

/** The rules that this change edits, in the order of its edits. Unknown IDs are skipped. */
export function affectedRules(change: RegChange, rules: Rule[]) {
  return change.edits.flatMap((e) => rules.find((r) => r.id === e.ruleId) ?? [])
}

/** Approved materials that depend on any affected rule, each once. They get flagged when the change is applied (F7). */
export function flaggedMaterials(change: RegChange, rules: Rule[], materials: Material[]) {
  const seen = new Map<string, Material>()
  for (const rule of affectedRules(change, rules)) {
    for (const m of dependentMaterials(rule, materials)) seen.set(m.id, m)
  }
  return [...seen.values()]
}
