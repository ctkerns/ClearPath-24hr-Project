import { useQuery } from '@tanstack/react-query'
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
  details: { targetStates: string; launchDate?: string; endDate?: string; destinationUrl?: string; metaAdId?: string }
  fields: { label: string; kind?: 'image'; segments: Segment[] }[]
  findings: Finding[]
  checklist: { ruleId: string; title: string; layer: 'code' | 'ai'; result: 'pass' | 'fail'; finding?: string; note?: string }[]
  groups: { name: string; state: GroupState; members?: string[]; by?: string; at?: string; reason: string }[]
  comments: { id: string; author: string; role: string; at: string; body: string }[]
}

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
  })
}

/**
 * The signed-in person. TODO: read from the session API.
 * The demo user is a Reviewer in the Compliance group, so the decision buttons show.
 */
export const demoViewer = { name: 'Jordan Kim', role: 'reviewer', groups: ['Compliance'] }
