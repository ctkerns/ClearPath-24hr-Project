import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Material } from '@/components/materials/material-data'
import { demoViewer, type MaterialDetail } from '@/components/review/material-detail-data'
import type { RiskLevel } from '@/components/ui/risk-tag'
import { uuidv7 } from '@/lib/uuid'
import type { Issue, IssueDetail, IssueStatus } from './issue-data'

/**
 * Changes to one issue in the demo cache: status, actions, the notice, and comments.
 * Each change also adds an activity entry, because the log is append-only.
 * TODO: replace with API calls. The server sends the notice email and records the audit entries.
 */
export function useIssueUpdate(issueId: string) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const now = () => new Date().toISOString()

  const update = (change: (d: IssueDetail) => IssueDetail, summary?: Partial<Issue>) => {
    queryClient.setQueryData<IssueDetail | null>(['issue-detail', issueId], (d) => (d ? change(d) : d))
    if (summary) queryClient.setQueryData<Issue[]>(['issues'], (list) => list?.map((i) => (i.id === issueId ? { ...i, ...summary } : i)))
  }
  const log = (d: IssueDetail, ...events: { text: string; comment?: boolean }[]): IssueDetail => ({
    ...d,
    activity: [...d.activity, ...events.map((e) => ({ at: now(), actor: demoViewer.name, ...e }))],
  })

  return {
    setStatus(status: IssueStatus, note?: string) {
      update(
        (d) => log(d, { text: t('issue.log.status', { status: t(`issues.status.${status}`) }) }, ...(note ? [{ text: note, comment: true }] : [])),
        { status, resolvedAt: status === 'resolved' ? now() : undefined },
      )
    },
    completeAction(actionId: string) {
      update((d) => {
        const action = d.actions.find((a) => a.id === actionId)
        const next = { ...d, actions: d.actions.map((a) => (a.id === actionId ? { ...a, done: true, doneBy: demoViewer.name, doneAt: now() } : a)) }
        return log(next, { text: t('issue.log.actionDone', { action: action?.label }) })
      })
    },
    sendNotice(subject: string, body: string) {
      update((d) => {
        if (!d.notice) return d
        const next: IssueDetail = {
          ...d,
          notice: { ...d.notice, subject, body, sentAt: now(), sentBy: demoViewer.name },
          actions: d.actions.map((a) => (a.kind === 'notice' ? { ...a, done: true, doneBy: demoViewer.name, doneAt: now() } : a)),
        }
        return log(next, { text: t('issue.log.noticeSent', { to: d.notice.to }) })
      })
    },
    comment(text: string) {
      update((d) => log(d, { text, comment: true }))
    },
  }
}

export type NewIssue = { title: string; severity: RiskLevel; summary: string; owner: string; dueDate: string }

/**
 * Opens an issue on a material (PRD F12: any Reviewer or higher, at any time). Returns the new issue ID.
 * TODO: replace with a POST to the API, which also notifies the owner (F13).
 */
export function useRaiseIssue() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  return (material: Material, input: NewIssue) => {
    const now = new Date().toISOString()
    const id = uuidv7()
    // The due date is a day; the issue is due at the end of it.
    const dueAt = new Date(`${input.dueDate}T23:59:00`).toISOString()
    const issue: Issue = {
      id,
      title: input.title,
      severity: input.severity,
      status: 'open',
      source: 'reviewer',
      material: { id: material.id, title: material.title, channel: material.channel },
      affiliate: material.affiliate,
      owner: input.owner,
      openedBy: demoViewer.name,
      dueAt,
      openedAt: now,
    }
    const opened = t('issue.log.raised', { owner: input.owner })
    const detail: IssueDetail = {
      id,
      summary: input.summary,
      actions: [],
      activity: [{ at: now, actor: demoViewer.name, text: opened }],
    }

    queryClient.setQueryData<Issue[]>(['issues'], (list = []) => [issue, ...list])
    queryClient.setQueryData(['issue-detail', id], detail)
    queryClient.setQueryData<MaterialDetail | null>(['material-detail', material.id], (d) =>
      d
        ? {
            ...d,
            issues: [...d.issues, { id, title: input.title, severity: input.severity, status: 'open', owner: input.owner, dueAt, openedAt: now, source: 'reviewer', actions: [] }],
            history: [...d.history, { at: now, actor: demoViewer.name, type: 'issue', text: t('issue.log.raisedHistory', { title: input.title, owner: input.owner }) }],
          }
        : d,
    )
    return id
  }
}
