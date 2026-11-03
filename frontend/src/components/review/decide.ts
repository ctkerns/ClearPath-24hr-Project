import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { SessionUser } from '@/lib/session'
import type { Decision, MaterialDetail } from './material-detail-data'

// Sends a review decision (PRD F5) to POST /api/materials/<id>/decisions. The server checks the role and
// the reviewer groups (R1, R2), writes the comment and the audit log, creates the approval ID and expiry
// from the workspace approval length (F15), and returns the new detail.

/** override: the written reason for approving with an open High finding (PRD F6). */
export type DecisionInput = { decision: Decision; text: string; group?: string; override?: string }

/** Required groups that still wait and that the viewer belongs to. A decision counts for all of them. */
export const groupsForViewer = (detail: MaterialDetail, viewer: SessionUser) =>
  detail.groups.filter((g) => g.state === 'waiting' && viewer.groups.includes(g.name)).map((g) => g.name)

/** Groups that the viewer approved, so the viewer can retract (PRD F5: only your own approval). */
export const approvedByViewer = (detail: MaterialDetail, viewer: SessionUser) =>
  detail.groups.filter((g) => g.state === 'approved' && g.by === viewer.name).map((g) => g.name)

export function useDecide(materialId: string) {
  const queryClient = useQueryClient()

  /** Rejects with an ApiError, so the dialog can show what went wrong. */
  return async (input: DecisionInput) => {
    const detail = await api<MaterialDetail>('POST', `/materials/${materialId}/decisions`, input)
    queryClient.setQueryData(['material-detail', materialId], detail)
    // The status, approval ID and group states in the list change too.
    await queryClient.invalidateQueries({ queryKey: ['materials'] })
  }
}
