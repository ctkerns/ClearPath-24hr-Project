import { useQuery } from '@tanstack/react-query'
import type { Channel } from '@/components/materials/material-data'
import type { RiskLevel } from '@/components/ui/risk-tag'

// Issues data (PRD F12). An issue comes from monitoring (a live problem) or from a reviewer.
// TODO: replace ISSUES_URL with the real API. The server must filter by role:
// an Affiliate gets only their own company's issues (PRD R4).
const ISSUES_URL = '/demo/issues.json'

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const SEVERITIES = ['high', 'medium', 'low'] as const satisfies readonly RiskLevel[]

export const ISSUE_SOURCES = ['monitoring', 'reviewer'] as const
export type IssueSource = (typeof ISSUE_SOURCES)[number]

/** Due date groups for the filter. Resolved issues are in none of them. */
export const DUE_BUCKETS = ['overdue', 'week', 'later'] as const
export type DueBucket = (typeof DUE_BUCKETS)[number]

export type Issue = {
  id: string
  title: string
  severity: RiskLevel
  status: IssueStatus
  source: IssueSource
  /** A summary of the linked material, so the list does not need a second request. */
  material: { id: string; title: string; channel: Channel }
  affiliate?: string
  /** For affiliate content: the internal person who takes over the issue after its due date (PRD section 4). */
  affiliateManager?: string
  owner: string
  dueAt: string
  openedAt: string
  resolvedAt?: string
}

export function useIssues() {
  return useQuery({
    queryKey: ['issues'],
    queryFn: async (): Promise<Issue[]> => {
      const res = await fetch(ISSUES_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).issues
    },
    staleTime: Infinity,
  })
}

/** True when an unresolved issue is past its due date. */
export const isOverdue = (issue: Issue) => issue.status !== 'resolved' && Date.parse(issue.dueAt) < Date.now()

export function dueBucket(issue: Issue): DueBucket | undefined {
  if (issue.status === 'resolved') return undefined
  if (isOverdue(issue)) return 'overdue'
  return Date.parse(issue.dueAt) - Date.now() <= 7 * 86_400_000 ? 'week' : 'later'
}

/** One remediation step (PRD F12). The kind decides which button the step offers. */
export type IssueAction = {
  id: string
  kind: 'pause' | 'restore' | 'new_version' | 'notice' | 'confirm_fix' | 'take_down' | 'find_author'
  label: string
  done: boolean
  doneBy?: string
  doneAt?: string
}

/** The activity log. Like the material history, it is append-only. */
export type IssueEvent = { at: string; actor: string; text: string; comment?: boolean }

export type IssueDetail = {
  id: string
  /** What is wrong, in one or two sentences. */
  summary: string
  rule?: { id: string; title: string }
  /** The approval condition that the live item breaks, for "Condition broken" issues. */
  condition?: string
  liveItem?: {
    connector: string
    externalId?: string
    url?: string
    /** platform_id is certain. similarity can be wrong, so the tool never pauses on it (PRD F10). */
    match: 'platform_id' | 'similarity'
    similarity?: number
    checkedAt: string
    paused: boolean
    fields: { label: string; text: string }[]
  }
  /** The last approved version, to compare with. Unapproved content has none. */
  approved?: { version: number; approvalId: string; fields: { label: string; text: string }[] }
  actions: IssueAction[]
  /** The AI draft of the affiliate notice or correction email. A person edits and sends it. */
  notice?: { to: string; cc?: string; subject: string; body: string; sentAt?: string; sentBy?: string }
  activity: IssueEvent[]
}

export function useIssueDetail(id: string) {
  return useQuery({
    queryKey: ['issue-detail', id],
    queryFn: async (): Promise<IssueDetail | null> => {
      const res = await fetch(`/demo/issues/${id}.json`)
      // Vite answers a missing file with index.html, so check the type too.
      if (res.status === 404 || !res.headers.get('content-type')?.includes('json')) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    staleTime: Infinity,
  })
}
