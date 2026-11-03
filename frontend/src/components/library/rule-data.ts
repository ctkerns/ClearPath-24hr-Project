import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { hasRole } from '@/components/settings/user-data'
import type { Role } from '@/components/review/material-detail-data'
import type { Channel, Product } from '@/components/materials/material-data'
import type { RiskLevel } from '@/components/ui/risk-tag'
import { useAfterFlagging } from './impact-data'

// Rules library (PRD F7, and company rules from F8). Managers edit it; every internal user reads it (R3).
// GET /api/library/rules. Affiliates cannot read it (R4).

export const RULE_KINDS = ['regulation', 'policy'] as const
export type RuleKind = (typeof RULE_KINDS)[number]

export const CHECK_LAYERS = ['code', 'ai'] as const
export type CheckLayer = (typeof CHECK_LAYERS)[number]

/** How a code rule is checked (PRD F7). AI rules carry guidance for the AI reviewer instead. */
export type RuleCheck =
  | { type: 'trigger_terms'; terms: string[]; disclosure: string }
  | { type: 'required_disclosure'; disclosure: string }
  | { type: 'phrase_required'; phrases: string[] }
  | { type: 'phrase_banned'; phrases: string[] }
  | { type: 'rate_sheet' }
  | { type: 'hidden_text' }
  | { type: 'ai'; guidance: string }

export type Rule = {
  id: string
  version: number
  title: string
  kind: RuleKind
  text: string
  /** "federal", a state code such as "CA", or "all" for company policy, which applies everywhere. */
  jurisdiction: string
  /** Empty means every product. */
  products: Product[]
  /** Empty means every channel. */
  channels: Channel[]
  /** Company rules have none. */
  citation: { label: string; url: string } | null
  effectiveDate: string
  owner: string
  severity: RiskLevel
  layer: CheckLayer
  check: RuleCheck
  /** A regulatory change in the queue affects this rule and waits for a Manager (F7). The server works it out. */
  pendingChange: boolean
  versions: { version: number; effectiveDate: string; by: string; note: string }[]
}

export function useRules() {
  return useQuery({
    queryKey: ['rules'],
    queryFn: () => api<Rule[]>('GET', '/library/rules'),
  })
}

/** R3: only Managers and Admins change the library (rules, disclosures, building blocks). The server checks too. */
export const canEditLibrary = (role: Role) => hasRole(role, 'manager')

/** The code checks a Manager can pick for a code rule (PRD F7). An AI rule has guidance instead. */
export const CODE_CHECK_TYPES = ['trigger_terms', 'required_disclosure', 'phrase_required', 'phrase_banned', 'rate_sheet', 'hidden_text'] as const
export type CodeCheckType = (typeof CODE_CHECK_TYPES)[number]

/** The body of POST and PATCH /api/library/rules. `note` says what changed, for the version history. */
export type RuleInput = Pick<Rule, 'title' | 'kind' | 'text' | 'jurisdiction' | 'products' | 'channels' | 'citation' | 'effectiveDate' | 'severity' | 'layer' | 'check'> & {
  note: string
}

/**
 * Managers only (R3); the server checks. Both save a version: create makes version 1, edit the next one.
 * An edit also flags the approved materials that depend on the rule for re-review (F7), so those reload too.
 * Each resolves with the saved rule, or rejects with an ApiError, so the dialog can show what went wrong.
 */
export function useRuleUpdate() {
  const queryClient = useQueryClient()
  const afterFlagging = useAfterFlagging()
  const after = async (rule: Rule) => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['rules'] }), afterFlagging()])
    return rule
  }
  return {
    create: (id: string, input: RuleInput) => api<Rule>('POST', '/library/rules', { id, ...input }).then(after),
    edit: (id: string, input: RuleInput) => api<Rule>('PATCH', `/library/rules/${encodeURIComponent(id)}`, input).then(after),
  }
}

/** True when another rule already uses this ID. The server compares exactly. */
export const ruleIdTaken = (rules: Rule[], id: string) => rules.some((r) => r.id === id.trim())
