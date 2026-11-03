import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canManageIssue, useIssueDetail, useIssues, type Issue } from '@/components/issues/issue-data'
import { IssueStatusPill } from '@/components/issues/issue-meta'
import { Activity, ActionList, IssuePanel, LiveContent } from '@/components/issues/issue-sections'
import { useIssueUpdate } from '@/components/issues/issue-update'
import { ResolveDialog } from '@/components/issues/resolve-dialog'
import { useIssueList } from '@/components/issues/use-issue-list'
import { useMaterials } from '@/components/materials/material-data'
import { ChannelIcon } from '@/components/materials/material-meta'
import { Button } from '@/components/ui/button'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelativeTime } from '@/i18n/format'
import { useViewer } from '@/lib/session'
import { useSave } from '@/lib/use-save'
import { SaveError } from '@/components/save-error'
import { LoadError } from '@/components/load-error'
import { notFoundError } from '@/lib/load-error'

export const Route = createFileRoute('/_app/issues/$issueId')({
  component: IssuePage,
})

/**
 * One issue (PRD F12), laid out like a document: what is wrong, the live evidence, the steps to fix it,
 * and the activity. The properties sit in a side panel, as on the material page.
 */
function IssuePage() {
  const { t } = useTranslation()
  const { issueId } = Route.useParams()
  const issues = useIssues()
  const detail = useIssueDetail(issueId)
  const materials = useMaterials()
  const { label } = useIssueList()
  const [resolving, setResolving] = useState(false)
  // TODO: the detail API should return the summary fields too, so the page needs one request.
  const issue = issues.data?.find((i) => i.id === issueId)

  if (issues.isPending || detail.isPending) return <PageSkeleton />
  // The detail call answers 404 for a missing issue and 403 for one this role cannot open.
  const failed = detail.error ?? issues.error ?? (issue && detail.data ? null : notFoundError)
  if (failed || !issue || !detail.data) {
    return (
      <div className="mx-auto grid max-w-7xl justify-items-start gap-3">
        <BackLink />
        <LoadError error={failed} what={t('issue.what')} onRetry={() => Promise.all([issues.refetch(), detail.refetch()])} />
      </div>
    )
  }
  const d = detail.data

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6">
      <Header issue={issue} onResolve={() => setResolving(true)} />
      <ResolveDialog issueId={issue.id} detail={d} open={resolving} onClose={() => setResolving(false)} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10">
        <div className="grid min-w-0 content-start gap-8">
          {d.summary && <p className="max-w-3xl text-base leading-relaxed">{d.summary}</p>}
          <LiveContent detail={d} />
          <ActionList issue={issue} detail={d} />
          <Activity issueId={issue.id} detail={d} />
        </div>
        <IssuePanel
          issue={issue}
          detail={d}
          material={issue.material && materials.data?.find((m) => m.id === issue.material?.id)}
          sourceLabel={label('source', issue.source)}
        />
      </div>
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/issues" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('nav.issues')}
    </Link>
  )
}

/** Title, severity and status, one line of facts, and the status buttons. */
function Header({ issue: i, onResolve }: { issue: Issue; onResolve: () => void }) {
  const { t } = useTranslation()
  const viewer = useViewer()
  const { setStatus } = useIssueUpdate(i.id)
  const { pending, error, run } = useSave(() => undefined)

  return (
    <header className="grid gap-2">
      <BackLink />
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{i.title}</h1>
            <IssueStatusPill status={i.status} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <SeverityLabel level={i.severity} />
            <span>{t(`review.live.source.${i.source}`)} · {formatRelativeTime(i.openedAt)}</span>
            {i.material ? (
              <Link to="/materials/$materialId" params={{ materialId: i.material.id }} className="flex items-center gap-1.5 hover:text-foreground hover:underline">
                <ChannelIcon channel={i.channel} className="size-3.5" />
                {i.material.title}
              </Link>
            ) : (
              <span className="flex items-center gap-1.5"><ChannelIcon channel={i.channel} className="size-3.5" />{t('issues.noMaterial')}</span>
            )}
          </p>
        </div>

        {/* Statuses move forward: Open, then In progress, then Resolved. Reopen is the only way back.
            Only the owner or a Manager changes them (PRD F12); the server checks it too. */}
        {canManageIssue(viewer, i) && (
          <div className="grid justify-items-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {i.status === 'open' && (
                <Button variant="outline" disabled={pending} onClick={() => void run(() => setStatus('in_progress'))}>{t('issue.startWork')}</Button>
              )}
              {i.status !== 'resolved' && <Button onClick={onResolve}>{t('issue.resolve.button')}</Button>}
              {i.status === 'resolved' && (
                <Button variant="outline" disabled={pending} onClick={() => void run(() => setStatus('open'))}><RotateCcw />{t('issue.reopen')}</Button>
              )}
            </div>
            <SaveError error={error} />
          </div>
        )}
      </div>
    </header>
  )
}

function PageSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-96 max-w-full" />
      <Skeleton className="h-3 w-72 max-w-full" />
      <Skeleton className="mt-4 h-64 w-full" />
    </div>
  )
}
