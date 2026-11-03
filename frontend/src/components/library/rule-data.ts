import { useQuery } from '@tanstack/react-query'
import type { Channel, Material, Product } from '@/components/materials/material-data'
import type { RiskLevel } from '@/components/ui/risk-tag'

// Rules library (PRD F7, and company rules from F8). Managers edit it; everyone else reads it (R3).
// TODO: replace RULES_URL with the real API.
const RULES_URL = '/demo/rules.json'

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
  citation?: { label: string; url: string }
  effectiveDate: string
  owner: string
  severity: RiskLevel
  layer: CheckLayer
  check: RuleCheck
  /** A regulatory change in the queue affects this rule and waits for a Manager (F7). */
  pendingChange?: boolean
  versions: { version: number; effectiveDate: string; by: string; note: string }[]
}

export function useRules() {
  return useQuery({
    queryKey: ['rules'],
    queryFn: async (): Promise<Rule[]> => {
      const res = await fetch(RULES_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).rules
    },
    staleTime: Infinity,
  })
}

/**
 * Approved materials that this rule applies to. When the rule changes, these get flagged for re-review (F7).
 * TODO: the server knows each material's checklist and target states; this demo matches on product and channel only.
 */
export function dependentMaterials(rule: Rule, materials: Material[]) {
  return materials.filter(
    (m) =>
      (m.status === 'approved' || m.status === 'live') &&
      (rule.products.length === 0 || rule.products.includes(m.product)) &&
      (rule.channels.length === 0 || rule.channels.includes(m.channel)),
  )
}
