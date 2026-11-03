import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Channel, Product } from '@/components/materials/material-data'
import i18n from '@/i18n'
import { api } from '@/lib/api'
import { hasRole } from './user-data'
import type { Role } from '@/components/review/material-detail-data'

// Review routing (PRD F6, screen 9): routing rules, the lighter path, and the no-material-change types.
// GET /api/routing: every internal role reads it, because the submit form previews routing. Managers and higher change it.
// The default group is a flag on the reviewer group itself (ReviewerGroup.isDefault); PUT /api/routing/default-group moves it.
// TODO: the server evaluates the rules on every new version.

export type RuleSource = 'internal' | 'affiliate'

/** Conditions on the fixed metadata fields (PRD F6). An empty list or a missing field means "any". */
export type RuleConditions = {
  products: Product[]
  channels: Channel[]
  /** Null or missing means any source. */
  source?: RuleSource | null
  /** The affiliate has an open issue, or a rejected version, in the last 90 days. Only for affiliate content. */
  affiliateHistory?: boolean
  /** Matches nationwide content. */
  nationwide?: boolean
  /** Matches content that targets any of these states. Nationwide content reaches every state, so it matches too. */
  states: string[]
}

export type RoutingRule = {
  id: string
  name: string
  enabled: boolean
  conditions: RuleConditions
  requiredGroupIds: string[]
  note?: string | null
  updatedBy: string | null
  updatedAt: string
}

/** The built-in list (PRD F6). The product defines it, because each type needs an exact code check. */
export const NO_MATERIAL_CHANGE_TYPES = ['rate_fee', 'offer_date', 'disclosure_refresh', 'block_swap', 'formatting', 'tracking_link'] as const
export type NoMaterialChangeType = (typeof NO_MATERIAL_CHANGE_TYPES)[number]

export type RoutingSettings = {
  rules: RoutingRule[]
  /** Null means "use the default group". */
  lighterPathGroupId: string | null
  noMaterialChangeTypes: Record<NoMaterialChangeType, boolean>
}

const KEY = ['routing']

export function useRouting() {
  return useQuery({ queryKey: KEY, queryFn: () => api<RoutingSettings>('GET', '/routing') })
}

/** Only Managers and higher change routing (PRD section 4). */
export const canManageRouting = (role: Role) => hasRole(role, 'manager')

export type RuleInput = Pick<RoutingRule, 'name' | 'conditions' | 'requiredGroupIds' | 'note'>

export const emptyRule: RuleInput = { name: '', conditions: { products: [], channels: [], states: [] }, requiredGroupIds: [] }

/**
 * Manager changes to routing. Each one calls the API, then reloads routing from the server.
 * Each function returns a promise that rejects with an ApiError, so a dialog can show what went wrong.
 * TODO: the server records each change in the audit log; open reviews keep their groups.
 */
export function useRoutingUpdate() {
  const queryClient = useQueryClient()
  const after = <T,>(call: Promise<T>) =>
    call.then(async (result) => {
      await queryClient.invalidateQueries({ queryKey: KEY })
      return result
    })
  /** These calls answer with the whole routing settings, so the cache takes them as they are. */
  const store = (call: Promise<RoutingSettings>) =>
    call.then((saved) => {
      queryClient.setQueryData(KEY, saved)
    })
  // JSON leaves out undefined, so send null to clear the note.
  const body = (input: RuleInput) => ({ ...input, note: input.note ?? null })

  return {
    create: (input: RuleInput) => after(api<RoutingRule>('POST', '/routing/rules', body(input))),
    edit: (id: string, input: RuleInput) => after(api<RoutingRule>('PATCH', `/routing/rules/${id}`, body(input))),
    remove: (id: string) => after(api('DELETE', `/routing/rules/${id}`)),
    setEnabled: (id: string, enabled: boolean) => after(api<RoutingRule>('PATCH', `/routing/rules/${id}`, { enabled })),
    /** Moves a rule one place up (-1) or down (1). Order is for reading only: every matching rule applies. */
    move: (id: string, by: -1 | 1) => store(api<RoutingSettings>('POST', `/routing/rules/${id}/move`, { by })),
    setLighterPathGroup: (groupId: string | null) => store(api<RoutingSettings>('PATCH', '/routing', { lighterPathGroupId: groupId })),
    setChangeType: (type: NoMaterialChangeType, on: boolean) =>
      store(api<RoutingSettings>('PATCH', '/routing', { noMaterialChangeTypes: { [type]: on } })),
    /** The default group is required, so this always moves the flag; it never clears it. The server does it in one transaction. */
    setDefaultGroup: (groupId: string) =>
      api('PUT', '/routing/default-group', { groupId }).then(() => queryClient.invalidateQueries({ queryKey: ['reviewer-groups'] })),
  }
}

/** The facts about one item that routing reads. */
export type RoutingInput = {
  product: Product
  channel: Channel
  source: RuleSource
  affiliateHistory: boolean
  nationwide: boolean
  states: string[]
}

/** Why a rule did not match: the first condition the item fails. */
export type Miss =
  | { field: 'product'; value: Product }
  | { field: 'channel'; value: Channel }
  | { field: 'source'; value: RuleSource }
  | { field: 'history' }
  | { field: 'states' }

export type RuleResult = { rule: RoutingRule; outcome: 'matched' | 'off' | 'skipped'; miss?: Miss }

export type RoutingResult = {
  results: RuleResult[]
  /** Each required group with the rules that asked for it. Empty rule list = the default group (no rule matched). */
  required: { groupId: string; ruleIds: string[] }[]
  usedDefault: boolean
}

function missOf(c: RuleConditions, v: RoutingInput): Miss | undefined {
  if (c.products.length && !c.products.includes(v.product)) return { field: 'product', value: v.product }
  if (c.channels.length && !c.channels.includes(v.channel)) return { field: 'channel', value: v.channel }
  const source = c.affiliateHistory ? 'affiliate' : c.source
  if (source && source !== v.source) return { field: 'source', value: v.source }
  if (c.affiliateHistory && !v.affiliateHistory) return { field: 'history' }
  if (c.nationwide || c.states.length) {
    const hit = v.nationwide ? c.nationwide || c.states.length > 0 : v.states.some((s) => c.states.includes(s))
    if (!hit) return { field: 'states' }
  }
  return undefined
}

/**
 * Which groups must review an item (PRD F6): all groups from all enabled rules that match it,
 * or the default group when none match, so no item is ever left without a reviewer.
 * TODO: the server runs this on every new version and stores matchedRuleIds on the version.
 */
export function evaluateRouting(rules: RoutingRule[], defaultGroupId: string | undefined, v: RoutingInput): RoutingResult {
  const results: RuleResult[] = rules.map((rule) => {
    if (!rule.enabled) return { rule, outcome: 'off' }
    const miss = missOf(rule.conditions, v)
    return miss ? { rule, outcome: 'skipped', miss } : { rule, outcome: 'matched' }
  })
  const required = new Map<string, string[]>()
  for (const r of results) {
    if (r.outcome !== 'matched') continue
    for (const g of r.rule.requiredGroupIds) required.set(g, [...(required.get(g) ?? []), r.rule.id])
  }
  const usedDefault = required.size === 0 && !!defaultGroupId
  if (usedDefault) required.set(defaultGroupId!, [])
  return { results, required: [...required].map(([groupId, ruleIds]) => ({ groupId, ruleIds })), usedDefault }
}

/** True when the rule has no conditions, so it matches every material. */
export const matchesEverything = (c: RuleConditions) =>
  !c.products.length && !c.channels.length && !c.source && !c.affiliateHistory && !c.nationwide && !c.states.length

/** "Mortgage or HELOC", "Legal and Mortgage": a list in the current language. */
export function formatList(items: string[], type: 'conjunction' | 'disjunction') {
  return new Intl.ListFormat(i18n.language, { style: 'long', type }).format(items)
}
