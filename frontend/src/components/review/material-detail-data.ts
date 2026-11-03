import { useQuery } from '@tanstack/react-query'
import { DEMO_ACCOUNTS, getSession } from '@/lib/session'
import type { IssueStatus } from '@/components/issues/issue-data'
import type { GroupState } from '@/components/materials/material-data'
import type { RiskLevel } from '@/components/ui/risk-tag'

// One material's current version, with its review: findings, checklist, groups and comments (PRD F4, F5).
// TODO: replace the demo URL with the real API. Only one demo material has a seeded file; others return 404.
const detailUrl = (id: string) => `/demo/materials/${id}.json`

/** Plain text, or text that a finding points to. */
export type Segment = string | { text: string; finding: string }

export type Finding = {
  id: string
  /** code = "Rule check" author, ai = "AI reviewer" author (PRD F4). */
  source: 'code' | 'ai'
  severity: RiskLevel
  ruleId: string
  status: 'open' | 'outdated' | 'hidden'
  text: string
  explanation: string
  suggestion?: string
}

export type MaterialDetail = {
  id: string
  version: number
  versionCount: number
  submittedAt: string
  submittedBy: string
  path: 'full' | 'lighter'
  details: { targetStates: string; launchDate?: string; endDate?: string; destinationUrl?: string; platformId?: string }
  fields: { label: string; kind?: 'image'; segments: Segment[] }[]
  findings: Finding[]
  checklist: { ruleId: string; title: string; layer: 'code' | 'ai'; result: 'pass' | 'fail'; finding?: string; note?: string }[]
  groups: { name: string; state: GroupState; members?: string[]; by?: string; at?: string; reason: string; escalatedBy?: string }[]
  /** Set by "Approve with conditions" (PRD F5). */
  conditions?: string
  comments: { id: string; author: string; role: string; at: string; body: string; decision?: Decision }[]
  versions: VersionSummary[]
  /** Append-only audit log (PRD F2). TODO: the API returns structured events, and the page writes the text. */
  history: HistoryEvent[]
  live: LiveItem[]
  issues: MaterialIssue[]
}

export type VersionSummary = {
  number: number
  submittedAt: string
  submittedBy: string
  path: 'full' | 'lighter'
  outcome?: 'approved' | 'changes_requested' | 'rejected'
  outcomeBy?: string
  /** The current version has no fields here; its content is in MaterialDetail.fields. */
  current?: boolean
  fields?: { label: string; text: string }[]
}

export type HistoryEvent = {
  at: string
  actor: string
  type: 'submitted' | 'prereview' | 'routed' | 'decision' | 'comment' | 'live' | 'issue'
  text: string
}

/** Content found live on a channel, and how it compares with the approved version (PRD F10). */
export type LiveItem = {
  id: string
  connector: string
  externalId: string
  /** platform_id is certain, so automatic pause is safe. similarity can be wrong, so a person checks it. */
  match: 'platform_id' | 'similarity'
  status: 'matched' | 'changed' | 'unapproved' | 'expired_approval' | 'condition_broken'
  foundAt: string
  checkedAt: string
  paused?: boolean
  fields: { label: string; text: string }[]
}

export type MaterialIssue = {
  id: string
  title: string
  severity: RiskLevel
  status: IssueStatus
  owner: string
  dueAt: string
  openedAt: string
  source: 'monitoring' | 'reviewer'
  actions: { label: string; done: boolean }[]
}

/** Plain text of a field, without the finding marks. */
export const fieldText = (segments: Segment[]) => segments.map((s) => (typeof s === 'string' ? s : s.text)).join('')

/** The decisions from PRD F5, plus retracting your own approval. */
export type Decision = 'approve' | 'approve_conditions' | 'request_changes' | 'reject' | 'escalate' | 'retract'

export function useMaterialDetail(id: string) {
  return useQuery({
    queryKey: ['material-detail', id],
    queryFn: async (): Promise<MaterialDetail | null> => {
      const res = await fetch(detailUrl(id))
      // Vite answers a missing file with index.html, so check the type too.
      if (res.status === 404 || !res.headers.get('content-type')?.includes('json')) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    // Demo decisions live only in this cache, so never refetch over them. TODO: remove with the real API.
    staleTime: Infinity,
  })
}

/** Roles from PRD section 4. */
export type Role = 'viewer' | 'submitter' | 'reviewer' | 'manager' | 'admin' | 'affiliate'

/**
 * The signed-in person, read once when the app loads. Sign-in and sign-out reload the page, so this stays current.
 * Without a session (only before the sign-in redirect runs) it falls back to the Reviewer demo account.
 * TODO: read from the session API, through a hook.
 */
export const demoViewer: { name: string; role: Role; groups: string[] } = getSession() ?? DEMO_ACCOUNTS[2]

/** Fields of any version as plain text. The current version's fields live in detail.fields. */
export const versionFields = (detail: MaterialDetail, v: VersionSummary) =>
  v.current ? detail.fields.map((f) => ({ label: f.label, text: fieldText(f.segments) })) : (v.fields ?? [])
