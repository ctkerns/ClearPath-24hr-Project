import { useQuery } from '@tanstack/react-query'
import { CHANNELS, PRODUCTS, type Channel, type Material, type Product } from '@/components/materials/material-data'
import type { ReviewerGroup } from '@/components/settings/group-data'
import { api } from '@/lib/api'

// Metrics dashboard data (PRD F14, the metrics in PRD section 2). GET /api/metrics, for internal users.
// The server makes one record per final decision and per live violation from the review tables, for the last
// two years, and the page counts them for its filters. So every number on the page comes from the same records.

/** One final decision on a material, with what happened on the way to it. */
export type Decision = {
  decidedAt: string
  channel: Channel
  product: Product
  /** The reviewer groups that had to approve. Compliance is always one. */
  groups: string[]
  /** "no_change": a new version with no material change, which takes the short path (PRD F6). */
  path: 'full' | 'no_change'
  /** Business days from submission to the final decision. */
  turnaroundDays: number
  /** Versions until the final decision. 1 means approved (or rejected) at version 1. */
  rounds: number
  outcome: 'approved' | 'rejected'
  /** Rule IDs of the findings that a reviewer kept, one per finding. */
  findings: string[]
  aiFindings: number
  /** AI findings that became "Outdated" because the next version changed the flagged text. */
  aiOutdated: number
  /** Human comments on selected text. */
  humanComments: number
  /** Human comments on text that no AI finding covered. */
  humanUncovered: number
  /** Monitoring later found a violation that was already there at approval. */
  laterViolation: boolean
}

/** One monitoring finding on live content (PRD F10). No daysToFix means it is still open. */
export type Violation = {
  foundAt: string
  channel: Channel
  /** None for unapproved content that matches no material. */
  product?: Product
  kind: 'changed' | 'unapproved' | 'condition_broken' | 'expired_approval'
  daysToFix?: number
}

export function useMetricsData() {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: () => api<{ decisions: Decision[]; violations: Violation[] }>('GET', '/metrics'),
  })
}

export const PERIODS = ['30d', '90d', '12m'] as const
export type Period = (typeof PERIODS)[number]

export type MetricsSearch = { period?: Period; channel?: Channel; product?: Product; group?: string }

export function validateMetricsSearch(raw: Record<string, unknown>): MetricsSearch {
  const one = <T extends string>(value: unknown, allowed: readonly T[]) => (allowed.includes(value as T) ? (value as T) : undefined)
  return {
    period: one(raw.period, PERIODS),
    channel: one(raw.channel, CHANNELS),
    product: one(raw.product, PRODUCTS),
    // Any group name: the list lives in Settings (Reviewer groups), and an unknown name just matches nothing.
    group: typeof raw.group === 'string' && raw.group ? raw.group : undefined,
  }
}

const DAY = 86_400_000
const periodDays: Record<Period, number> = { '30d': 30, '90d': 91, '12m': 365 }

/** The current period and the one just before it, the same length, for the change figures. */
export function periodRange(period: Period, now = Date.now()) {
  const length = periodDays[period] * DAY
  return { start: now - length, end: now, previousStart: now - 2 * length }
}

function inRange(at: string, start: number, end: number) {
  const time = new Date(at).getTime()
  return time >= start && time < end
}

function matches(item: { channel: Channel; product?: Product; groups?: string[] }, f: MetricsSearch) {
  return (!f.channel || item.channel === f.channel) && (!f.product || item.product === f.product) && (!f.group || !item.groups || item.groups.includes(f.group))
}

/** Decisions and violations for the filters, split into the current and the previous period. */
export function slice(data: { decisions: Decision[]; violations: Violation[] }, f: MetricsSearch, now = Date.now()) {
  const { start, end, previousStart } = periodRange(f.period ?? '90d', now)
  const decisions = data.decisions.filter((d) => matches(d, f))
  // Live content has no reviewer group of its own, so the group filter does not apply to violations.
  const violations = data.violations.filter((v) => matches(v, { ...f, group: undefined }))
  return {
    start,
    end,
    decisions: decisions.filter((d) => inRange(d.decidedAt, start, end)),
    previous: decisions.filter((d) => inRange(d.decidedAt, previousStart, start)),
    violations: violations.filter((v) => inRange(v.foundAt, start, end)),
    previousViolations: violations.filter((v) => inRange(v.foundAt, previousStart, start)),
  }
}

/** The value at fraction p of the sorted list (0.5 = median, 0.9 = p90). Undefined when the list is empty. */
export function percentile(values: number[], p: number) {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const low = Math.floor(index)
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low)
}

function ratio(part: number, whole: number) {
  return whole ? part / whole : undefined
}

/** The headline figures for one set of decisions. Undefined means there is nothing to count. */
export function summary(decisions: Decision[]) {
  const turnaround = decisions.map((d) => d.turnaroundDays)
  const approved = decisions.filter((d) => d.outcome === 'approved')
  const full = decisions.filter((d) => d.path === 'full')
  const ai = full.reduce((sum, d) => sum + d.aiFindings, 0)
  const comments = full.reduce((sum, d) => sum + d.humanComments, 0)
  return {
    count: decisions.length,
    median: percentile(turnaround, 0.5),
    p90: percentile(turnaround, 0.9),
    firstPass: ratio(approved.filter((d) => d.rounds === 1).length, approved.length),
    rounds: approved.length ? approved.reduce((sum, d) => sum + d.rounds, 0) / approved.length : undefined,
    postApprovalViolation: ratio(approved.filter((d) => d.laterViolation).length, approved.length),
    aiFixRate: ratio(full.reduce((sum, d) => sum + d.aiOutdated, 0), ai),
    aiMissRate: ratio(full.reduce((sum, d) => sum + d.humanUncovered, 0), comments),
  }
}

export type Bucket = { start: number; label: Date }

/** Weeks for the short periods, months for the year. Each bucket starts at its own date. */
export function buckets(period: Period, start: number, end: number): Bucket[] {
  const out: Bucket[] = []
  if (period === '12m') {
    const d = new Date(start)
    let cursor = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    out.push({ start, label: new Date(d.getFullYear(), d.getMonth(), 1) })
    while (cursor < end) {
      out.push({ start: cursor, label: new Date(cursor) })
      const c = new Date(cursor)
      cursor = new Date(c.getFullYear(), c.getMonth() + 1, 1).getTime()
    }
    return out
  }
  for (let t = start; t < end; t += 7 * DAY) out.push({ start: t, label: new Date(t) })
  return out
}

/** Splits items into the buckets by a date field. */
export function byBucket<T>(items: T[], at: (item: T) => string, list: Bucket[]) {
  const groups = list.map(() => [] as T[])
  for (const item of items) {
    const time = new Date(at(item)).getTime()
    let i = list.length - 1
    while (i > 0 && list[i].start > time) i--
    groups[i].push(item)
  }
  return groups
}

/** Turnaround by reviewer group (names from Settings) and path. A decision counts once for every group it needed. */
export function turnaroundByGroup(decisions: Decision[], groupNames: string[]) {
  return groupNames.map((group) => {
    const mine = decisions.filter((d) => d.groups.includes(group))
    const full = mine.filter((d) => d.path === 'full').map((d) => d.turnaroundDays)
    const short = mine.filter((d) => d.path === 'no_change').map((d) => d.turnaroundDays)
    return {
      group,
      count: mine.length,
      full: { median: percentile(full, 0.5), p90: percentile(full, 0.9) },
      short: { median: percentile(short, 0.5), p90: percentile(short, 0.9) },
    }
  }).filter((row) => row.count > 0)
}

/** Findings by rule, most common first. */
export function topRules(decisions: Decision[], limit = 8) {
  const counts = new Map<string, number>()
  for (const d of decisions) for (const id of d.findings) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count).slice(0, limit)
}

/** Live violations by channel, most first, with the median days to fix the ones that are fixed. */
export function violationsByChannel(violations: Violation[]) {
  return CHANNELS.map((channel) => {
    const mine = violations.filter((v) => v.channel === channel)
    const fixed = mine.flatMap((v) => (v.daysToFix === undefined ? [] : [v.daysToFix]))
    return { channel, count: mine.length, open: mine.length - fixed.length, medianFix: percentile(fixed, 0.5) }
  }).filter((row) => row.count > 0).sort((a, b) => b.count - a.count)
}

export const QUEUE_STATUSES = ['submitted', 'in_review', 'changes_requested'] as const
export const AGE_BUCKETS = ['0-1', '2-3', '4-5', '6+'] as const
/** The fewest business days an item in each age bucket has waited. */
const AGE_BUCKET_MIN = [0, 2, 4, 6]

/**
 * The review target the queue table compares with: the filtered group's, or the default group's when no group is
 * picked (every unmatched submission goes there). From Settings, so a changed target shows here at once.
 */
export function queueTarget(groups: ReviewerGroup[], groupName?: string) {
  const group = (groupName && groups.find((g) => g.name === groupName)) || groups.find((g) => g.isDefault)
  return group && { name: group.name, days: group.targetBusinessDays }
}

/** True when every item in the age bucket has waited longer than the target. */
export const bucketPastTarget = (bucketIndex: number, targetDays: number) => AGE_BUCKET_MIN[bucketIndex] > targetDays

/** Whole business days between two times. */
export function businessDaysBetween(from: number, to: number) {
  let days = 0
  for (let t = from + DAY; t <= to; t += DAY) {
    const dow = new Date(t).getDay()
    if (dow !== 0 && dow !== 6) days++
  }
  return days
}

/**
 * The open queue now, by status and by business days waiting. It comes from the materials list, so it agrees with it.
 * The date filter does not apply: the queue is always "now".
 */
export function queueNow(materials: Material[], f: MetricsSearch, now = Date.now()) {
  const open = materials.filter((m) => (QUEUE_STATUSES as readonly string[]).includes(m.status) && matches({ ...m, groups: m.groups.map((g) => g.name) }, f))
  const ageOf = (m: Material) => businessDaysBetween(new Date(m.submittedAt ?? m.updatedAt).getTime(), now)
  const bucketOf = (days: number) => (days <= 1 ? '0-1' : days <= 3 ? '2-3' : days <= 5 ? '4-5' : '6+')
  const rows = QUEUE_STATUSES.map((status) => {
    const mine = open.filter((m) => m.status === status)
    return { status, total: mine.length, cells: AGE_BUCKETS.map((b) => mine.filter((m) => bucketOf(ageOf(m)) === b).length) }
  })
  const oldest = open.reduce((max, m) => Math.max(max, ageOf(m)), 0)
  return { rows, total: open.length, oldest, totals: AGE_BUCKETS.map((_, i) => rows.reduce((sum, r) => sum + r.cells[i], 0)) }
}
