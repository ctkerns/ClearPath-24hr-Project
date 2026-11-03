import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListPage } from '@/components/list/list-filters'
import type { Channel } from '@/components/materials/material-data'
import type { RiskLevel } from '@/components/ui/risk-tag'
import { hasRole } from '@/components/settings/user-data'
import { api } from '@/lib/api'
import type { SessionUser } from '@/lib/session'

// Issues data (PRD F12). An issue comes from monitoring (a live problem) or from a reviewer.
// GET /api/issues and /api/issues/<id>. The server filters by role:
// an Affiliate gets only their own company's issues (PRD R4).

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const SEVERITIES = ['high', 'medium', 'low'] as const satisfies readonly RiskLevel[]

export const ISSUE_SOURCES = ['monitoring', 'reviewer'] as const
export type IssueSource = (typeof ISSUE_SOURCES)[number]

/** What monitoring found on live content (PRD F10). An issue that is not a live problem has none. */
export const ISSUE_KINDS = ['changed', 'unapproved', 'condition_broken', 'expired_approval'] as const
export type IssueKind = (typeof ISSUE_KINDS)[number]

/** Due date groups for the filter, counted on the server: past due, due within 7 days, later. Resolved issues are in none. */
export const DUE_BUCKETS = ['overdue', 'week', 'later'] as const
export type DueBucket = (typeof DUE_BUCKETS)[number]

export type Issue = {
  id: string
  title: string
  severity: RiskLevel
  status: IssueStatus
  source: IssueSource
  kind?: IssueKind
  /**
   * A summary of the linked material, so the list does not need a second request. None for unapproved content
   * that monitoring found live and that matches no material (PRD F10); only internal users see those issues.
   */
  material?: { id: string; title: string; channel: Channel }
  /** The material's channel, or where monitoring found the content. */
  channel: Channel
  affiliate?: string
  /** For affiliate content: the internal person who takes over the issue after its due date (PRD section 4). */
  affiliateManager?: string
  /** Who raised it, for issues that a reviewer opened. */
  openedBy?: string
  owner: string
  ownerId: string
  dueAt: string
  openedAt: string
  resolvedAt?: string
}

/** PRD F12: the issue owner, or a Manager and higher, changes the status and runs the steps. A Viewer only reads. */
export const canManageIssue = (viewer: SessionUser, issue: Issue) =>
  hasRole(viewer.role, 'manager') || (viewer.id === issue.ownerId && (viewer.role === 'affiliate' || hasRole(viewer.role, 'submitter')))

/** Every issue the viewer may see, unfiltered, for the dashboard and the issue page. The Issues list uses useIssuePage. */
export function useIssues() {
  return useQuery({
    queryKey: ['issues'],
    queryFn: () => api<ListPage<Issue>>('GET', '/issues'),
    select: (page) => page.items,
  })
}

/** One page of the Issues list, filtered, searched and sorted on the server. `params` is from serverParams. */
export function useIssuePage(params: string) {
  return useQuery({
    queryKey: ['issues', 'page', params],
    queryFn: () => api<ListPage<Issue>>('GET', `/issues?${params}`),
    placeholderData: keepPreviousData,
  })
}

/** True when an unresolved issue is past its due date. */
export const isOverdue = (issue: Issue) => issue.status !== 'resolved' && Date.parse(issue.dueAt) < Date.now()

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
    queryFn: () => api<IssueDetail>('GET', `/issues/${id}`),
  })
}
