import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Channel, Product } from '@/components/materials/material-data'
import { demoViewer } from '@/components/review/material-detail-data'
import i18n from '@/i18n'
import { uuidv7 } from '@/lib/uuid'
import type { ReviewerGroup } from './group-data'
import { hasRole } from './user-data'

// Review routing (PRD F6, screen 9): routing rules, the lighter path, and the no-material-change types.
// The default group is a flag on the reviewer group itself (ReviewerGroup.isDefault), so this tab writes it there.
// TODO: replace ROUTING_URL with the real API (Managers and higher for changes; the server checks the role
// and evaluates the rules on every new version).
const ROUTING_URL = '/demo/routing.json'

export type RuleSource = 'internal' | 'affiliate'

/** Conditions on the fixed metadata fields (PRD F6). An empty list or a missing field means "any". */
export type RuleConditions = {
  products: Product[]
  channels: Channel[]
  source?: RuleSource
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
  note?: string
  updatedBy: string
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

export function useRouting() {
  return useQuery({
    queryKey: ['routing'],
    queryFn: async (): Promise<RoutingSettings> => {
      const res = await fetch(ROUTING_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    // Demo changes live only in this cache (setQueryData), so never refetch over them. TODO: remove with the real API.
    staleTime: Infinity,
  })
}

/** Only Managers and higher change routing (PRD section 4). */
export const canManageRouting = () => hasRole(demoViewer.role, 'manager')

export type RuleInput = Pick<RoutingRule, 'name' | 'conditions' | 'requiredGroupIds' | 'note'>

export const emptyRule: RuleInput = { name: '', conditions: { products: [], channels: [], states: [] }, requiredGroupIds: [] }

/**
 * Demo changes to routing, written to the query cache.
 * TODO: replace with API calls. The server records each change in the audit log; open reviews keep their groups.
 */
export function useRoutingUpdate() {
  const queryClient = useQueryClient()
  const stamp = () => ({ updatedBy: demoViewer.name, updatedAt: new Date().toISOString() })

  const set = (change: (s: RoutingSettings) => RoutingSettings) =>
    queryClient.setQueryData<RoutingSettings>(['routing'], (s) => (s ? change(s) : s))
  const setRules = (change: (rules: RoutingRule[]) => RoutingRule[]) => set((s) => ({ ...s, rules: change(s.rules) }))

  return {
    create(input: RuleInput) {
      setRules((rules) => [...rules, { id: uuidv7(), enabled: true, ...input, ...stamp() }])
    },
    edit(id: string, input: RuleInput) {
      setRules((rules) => rules.map((r) => (r.id === id ? { ...r, ...input, ...stamp() } : r)))
    },
    remove(id: string) {
      setRules((rules) => rules.filter((r) => r.id !== id))
    },
    setEnabled(id: string, enabled: boolean) {
      setRules((rules) => rules.map((r) => (r.id === id ? { ...r, enabled, ...stamp() } : r)))
    },
    /** Moves a rule one place up (-1) or down (1). Order is for reading only: every matching rule applies. */
    move(id: string, by: -1 | 1) {
      setRules((rules) => {
        const i = rules.findIndex((r) => r.id === id)
        const j = i + by
        if (i < 0 || j < 0 || j >= rules.length) return rules
        const next = [...rules]
        ;[next[i], next[j]] = [next[j], next[i]]
        return next
      })
    },
    setLighterPathGroup(groupId: string | null) {
      set((s) => ({ ...s, lighterPathGroupId: groupId }))
    },
    setChangeType(type: NoMaterialChangeType, on: boolean) {
      set((s) => ({ ...s, noMaterialChangeTypes: { ...s.noMaterialChangeTypes, [type]: on } }))
    },
    /** The default group is required, so this always moves the flag; it never clears it. */
    setDefaultGroup(groupId: string) {
      queryClient.setQueryData<ReviewerGroup[]>(['reviewer-groups'], (list) => list?.map((g) => ({ ...g, isDefault: g.id === groupId })))
    },
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
