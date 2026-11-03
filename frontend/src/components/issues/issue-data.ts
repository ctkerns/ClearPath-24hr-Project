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
