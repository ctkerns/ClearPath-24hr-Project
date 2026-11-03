import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAfterFlagging } from './impact-data'
import type { Rule } from './rule-data'

// Regulatory change queue (PRD F7). A feed connector (compliance.ai, Wolters Kluwer) adds the items;
// that connector is P2 and unverified (F11), so the demo seeds them. GET /api/library/regulatory-changes.

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
  reviewingBy: string | null
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
}

export function useRegChanges() {
  return useQuery({
    queryKey: ['regulatory-changes'],
    queryFn: () => api<RegChange[]>('GET', '/library/regulatory-changes'),
  })
}

export type RegChangeDecision = 'apply' | 'dismiss'

/**
 * Managers only (R3); the server checks. Apply writes the suggested text into each rule as a new version.
 * Dismiss needs a reason. Both reload the changes and the rules, because a rule's text and pending flag change.
 * Apply also flags the approved materials that depend on these rules (F7), so those reload too.
 * Rejects with an ApiError, so the dialog can show what went wrong.
 */
export function useDecideRegChange() {
  const queryClient = useQueryClient()
  const afterFlagging = useAfterFlagging()
  return async (id: string, decision: RegChangeDecision, note: string) => {
    await api<RegChange>('POST', `/library/regulatory-changes/${encodeURIComponent(id)}/${decision}`, { note: note || null })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] }),
      queryClient.invalidateQueries({ queryKey: ['rules'] }),
      afterFlagging(),
    ])
  }
}

/** Not decided yet: new, or opened by a Manager. */
export const isUndecided = (c: RegChange) => c.status === 'waiting' || c.status === 'in_review'

/** The rules that this change edits, in the order of its edits. Unknown IDs are skipped. */
export function affectedRules(change: RegChange, rules: Rule[]) {
  return change.edits.flatMap((e) => rules.find((r) => r.id === e.ruleId) ?? [])
}
