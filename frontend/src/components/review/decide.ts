import { useQueryClient } from '@tanstack/react-query'
import type { Material } from '@/components/materials/material-data'
import type { MaterialStatus } from '@/components/ui/status-pill'
import { demoViewer, type Decision, type MaterialDetail } from './material-detail-data'

// Applies a review decision (PRD F5) to the demo data in the query cache.
// TODO: replace with a POST to the decisions API; the server checks the role, writes the audit log,
// creates the approval ID and expiry, and returns the new state.

export type DecisionInput = { decision: Decision; text: string; group?: string }

/** Required groups that still wait and that the viewer belongs to. A decision counts for all of them. */
export const groupsForViewer = (detail: MaterialDetail) =>
  detail.groups.filter((g) => g.state === 'waiting' && demoViewer.groups.includes(g.name)).map((g) => g.name)

/** Groups that the viewer approved, so the viewer can retract (PRD F5: only your own approval). */
export const approvedByViewer = (detail: MaterialDetail) =>
  detail.groups.filter((g) => g.state === 'approved' && g.by === demoViewer.name).map((g) => g.name)

export function useDecide(materialId: string) {
  const queryClient = useQueryClient()

  return ({ decision, text, group }: DecisionInput) => {
    const detail = queryClient.getQueryData<MaterialDetail | null>(['material-detail', materialId])
    if (!detail) return
    const now = new Date().toISOString()
    const mine = groupsForViewer(detail)

    let groups = detail.groups
    let status: MaterialStatus = 'in_review'
    let approval: Pick<Material, 'approvalId' | 'expiresAt'> = {}

    switch (decision) {
      case 'approve':
      case 'approve_conditions':
        groups = groups.map((g) => (mine.includes(g.name) ? { ...g, state: 'approved', by: demoViewer.name, at: now } : g))
        if (groups.every((g) => g.state === 'approved')) {
          status = 'approved'
          // TODO: the server sets the expiry from the rule, disclosure and rate dates. One year is a placeholder.
          const expires = new Date()
          expires.setFullYear(expires.getFullYear() + 1)
          approval = {
            approvalId: `CP-${expires.getFullYear() - 1}-${String(Math.floor(1000 + Math.random() * 9000))}-v${detail.version}`,
            expiresAt: expires.toISOString().slice(0, 10),
          }
        }
        break
      case 'request_changes':
        groups = groups.map((g) => (mine.includes(g.name) ? { ...g, state: 'changes', by: demoViewer.name, at: now } : g))
        status = 'changes_requested'
        break
      case 'reject':
        groups = groups.map((g) => (mine.includes(g.name) ? { ...g, state: 'rejected', by: demoViewer.name, at: now } : g))
        status = 'rejected'
        break
      case 'escalate':
        if (group) groups = [...groups, { name: group, state: 'waiting', reason: text, escalatedBy: demoViewer.name }]
        break
      case 'retract': {
        // The groups that the approval covered count as waiting again (PRD section 6).
        const retracted = approvedByViewer(detail)
        groups = groups.map((g) => (retracted.includes(g.name) ? { name: g.name, state: 'waiting', members: g.members, reason: g.reason } : g))
        approval = { approvalId: undefined, expiresAt: undefined }
        break
      }
    }

    const comment = {
      id: `c-${Date.now()}`,
      author: demoViewer.name,
      role: demoViewer.groups.join(', '),
      at: now,
      body: decision === 'escalate' && group ? `${group}: ${text}` : text,
      decision,
    }

    queryClient.setQueryData<MaterialDetail>(['material-detail', materialId], {
      ...detail,
      groups,
      conditions: decision === 'approve_conditions' ? text : decision === 'retract' ? undefined : detail.conditions,
      comments: [...detail.comments, comment],
    })
    queryClient.setQueryData<Material[]>(['materials'], (list) =>
      list?.map((m) =>
        m.id === materialId
          ? { ...m, ...approval, status, updatedAt: now, groups: groups.map((g) => ({ name: g.name, state: g.state })) }
          : m,
      ),
    )
  }
}
