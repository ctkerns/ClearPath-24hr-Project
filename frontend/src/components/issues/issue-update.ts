import { useQueryClient } from '@tanstack/react-query'
import type { RiskLevel } from '@/components/ui/risk-tag'
import { api } from '@/lib/api'
import type { Issue, IssueDetail, IssueKind, IssueStatus } from './issue-data'

/**
 * Changes to one issue: status, actions, the notice, and comments (PRD F12). Each one calls the API,
 * which checks who may do it (the owner or a Manager) and adds the activity entry, because the log is append-only.
 * The new detail goes into the cache; the lists reload, because the status and steps show there too.
 * Each function returns a promise that rejects with an ApiError, so the page can show what went wrong.
 * TODO (F13): the server sends the notice email.
 */
export function useIssueUpdate(issueId: string) {
  const queryClient = useQueryClient()

  const after = async (call: Promise<IssueDetail>) => {
    const detail = await call
    queryClient.setQueryData(['issue-detail', issueId], detail)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issues'] }),
      // The material page lists its issues and their steps.
      queryClient.invalidateQueries({ queryKey: ['material-detail'] }),
    ])
  }

  return {
    /** Resolving needs a note on how the problem was fixed. */
    setStatus: (status: IssueStatus, note?: string) => after(api('PATCH', `/issues/${issueId}`, { status, note: note ?? '' })),
    completeAction: (actionId: string) => after(api('POST', `/issues/${issueId}/actions/${actionId}/done`)),
    sendNotice: (subject: string, body: string) => after(api('POST', `/issues/${issueId}/notice`, { subject, body })),
    comment: (text: string) => after(api('POST', `/issues/${issueId}/comments`, { text })),
  }
}

export type NewIssue = {
  title: string
  severity: RiskLevel
  summary: string
  ownerId: string
  dueDate: string
  /** A live problem (PRD F10), when the reviewer found one */
  kind?: IssueKind
  /** The problem was already in the approved version: it counts in the post-approval violation rate (PRD section 2). */
  presentAtApproval?: boolean
}

/**
 * Opens an issue on a material (PRD F12: any Reviewer or higher, at any time). Resolves with the new issue ID.
 * TODO (F13): the server also notifies the owner.
 */
export function useRaiseIssue() {
  const queryClient = useQueryClient()

  return async (materialId: string, input: NewIssue) => {
    const issue = await api<Issue>('POST', '/issues', {
      materialId,
      title: input.title,
      severity: input.severity,
      summary: input.summary,
      ownerId: input.ownerId,
      kind: input.kind,
      presentAtApproval: input.presentAtApproval ?? false,
      // The due date is a day; the issue is due at the end of it, in the person's time zone.
      dueAt: new Date(`${input.dueDate}T23:59:00`).toISOString(),
    })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issues'] }),
      queryClient.invalidateQueries({ queryKey: ['material-detail', materialId] }),
    ])
    return issue.id
  }
}
