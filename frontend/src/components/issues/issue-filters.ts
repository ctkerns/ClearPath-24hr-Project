import { validatePagedSearch } from '@/components/list/list-filters'
import { CHANNELS } from '@/components/materials/material-data'
import { DUE_BUCKETS, ISSUE_SOURCES, ISSUE_STATUSES, SEVERITIES } from './issue-data'

// Issues list configuration: filter keys, sorts and quick views. Labels and menus are in use-issue-list.tsx.
// The server filters, searches, sorts and pages (GET /api/issues, backend/src/app/issue_list.py):
// these keys and values are its query parameters. The due buckets are counted on the server too.

export const ISSUE_FILTER_KEYS = ['status', 'severity', 'due', 'source', 'channel', 'owner', 'affiliate'] as const
export type IssueFilterKey = (typeof ISSUE_FILTER_KEYS)[number]

/** "due" and "severity" put resolved issues last, so the work to do stays at the top. */
export const ISSUE_SORTS = ['due', 'opened', 'severity', 'title'] as const
export type IssueSort = (typeof ISSUE_SORTS)[number]

/** The fixed values from the PRD. People and affiliates come from the server's counts. */
export const ISSUE_FIXED: Partial<Record<IssueFilterKey, readonly string[]>> = {
  status: ISSUE_STATUSES,
  severity: SEVERITIES,
  due: DUE_BUCKETS,
  source: ISSUE_SOURCES,
  channel: CHANNELS,
}

export const validateIssuesSearch = (raw: Record<string, unknown>) => validatePagedSearch(raw, ISSUE_FILTER_KEYS, ISSUE_SORTS, ISSUE_FIXED)

export const ISSUE_PRESETS = [
  { key: 'all', filters: {} },
  { key: 'open', filters: { status: 'open,in_progress' } },
  { key: 'overdue', filters: { due: 'overdue' } },
  { key: 'resolved', filters: { status: 'resolved' } },
] as const
