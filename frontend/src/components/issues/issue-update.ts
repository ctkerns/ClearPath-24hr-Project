import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { demoViewer } from '@/components/review/material-detail-data'
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
