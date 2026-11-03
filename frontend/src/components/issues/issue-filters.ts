import { validateListSearch, type ListSearch } from '@/components/list/list-filters'
import { dueBucket, type Issue } from './issue-data'

// Issues list configuration: filter keys, sorts and quick views. Labels and menus are in use-issue-list.tsx.

export const ISSUE_FILTER_KEYS = ['status', 'severity', 'due', 'source', 'channel', 'owner', 'affiliate'] as const
export type IssueFilterKey = (typeof ISSUE_FILTER_KEYS)[number]

export const ISSUE_SORTS = ['due', 'opened', 'severity', 'title'] as const
export type IssueSort = (typeof ISSUE_SORTS)[number]

export const validateIssuesSearch = (raw: Record<string, unknown>) => validateListSearch(raw, ISSUE_FILTER_KEYS, ISSUE_SORTS)

export function issueValues(issue: Issue, key: IssueFilterKey): string[] {
  switch (key) {
    case 'status': return [issue.status]
    case 'severity': return [issue.severity]
    case 'due': { const b = dueBucket(issue); return b ? [b] : [] }
    case 'source': return [issue.source]
    case 'channel': return [issue.material.channel]
    case 'owner': return [issue.owner]
    case 'affiliate': return issue.affiliate ? [issue.affiliate] : []
  }
}

export const issueSearchText = (i: Issue) => [i.title, i.material.title, i.affiliate, i.owner]

const severityRank = { high: 0, medium: 1, low: 2 }
/** Resolved issues always go last, so the work to do stays at the top. */
const resolvedLast = (a: Issue, b: Issue) => Number(a.status === 'resolved') - Number(b.status === 'resolved')

export function sortIssues(issues: Issue[], search: ListSearch) {
  const list = [...issues]
  switch ((search.sort ?? 'due') as IssueSort) {
    case 'due': return list.sort((a, b) => resolvedLast(a, b) || a.dueAt.localeCompare(b.dueAt))
    case 'opened': return list.sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    case 'severity': return list.sort((a, b) => resolvedLast(a, b) || severityRank[a.severity] - severityRank[b.severity] || a.dueAt.localeCompare(b.dueAt))
    case 'title': return list.sort((a, b) => a.title.localeCompare(b.title))
  }
}

export const ISSUE_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'open', filters: { status: 'open,in_progress' } },
  { key: 'overdue', filters: { due: 'overdue' } },
  { key: 'resolved', filters: { status: 'resolved' } },
] as const
