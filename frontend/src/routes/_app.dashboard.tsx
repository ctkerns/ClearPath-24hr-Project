import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Plus } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { daysToDeadline, myIssues, myQueue, mySubmissions } from '@/components/dashboard/dashboard-data'
import { isOverdue, useIssues, type Issue } from '@/components/issues/issue-data'
import { IssueStatusPill } from '@/components/issues/issue-meta'
import { listRowClass } from '@/components/list/list-filters'
import { daysUntil, LIVE_PROBLEMS, useMaterials, type Material } from '@/components/materials/material-data'
import { ChannelIcon, GroupApprovals, PersonAvatar } from '@/components/materials/material-meta'
import { demoViewer } from '@/components/review/material-detail-data'
import { useReviewerGroups } from '@/components/settings/group-data'
import { Button } from '@/components/ui/button'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { formatDate, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
})

/**
 * Dashboard (PRD screen 2, "Home dashboard"): the signed-in person's own work, most urgent first.
 * No chart cards: the numbers live in Metrics. Each section is a short list that links to the full, filtered list.
 * TODO: order the sections by role. A Submitter or Affiliate sees My submissions first, and has no queue.
 */
function DashboardPage() {
  const { t } = useTranslation()
  const materials = useMaterials()
  const issues = useIssues()
  const groups = useReviewerGroups()
  const viewer = demoViewer

  if (materials.isPending || issues.isPending || groups.isPending) return <DashboardSkeleton />
  const allMaterials = materials.data ?? []
  const allIssues = issues.data ?? []
  const queue = myQueue(allMaterials, viewer, groups.data ?? [])
  const late = queue.filter((q) => daysToDeadline(q.deadline) < 0).length
  const mine = myIssues(allIssues, viewer)
  const submissions = mySubmissions(allMaterials, viewer)

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8">
      {/* No visible heading: the active tab already names the page, as on Materials and Issues. */}
      <h1 className="sr-only">{t('page.dashboard')}</h1>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid min-w-0 content-start gap-8">
          <Section
            title={t('dashboard.queue.title')}
            count={queue.length}
            note={late > 0 && <span className="rounded-sm bg-risk-high-soft px-1.5 py-0.5 text-xs font-semibold text-risk-high shadow-[inset_0_0_0_1px_currentColor]">{t('dashboard.queue.late', { count: late })}</span>}
            empty={t('dashboard.queue.empty')}
            viewAll={<Link to="/materials" search={{ status: 'submitted,in_review', group: viewer.groups.join(',') }}>{t('dashboard.viewAll')}</Link>}
          >
            {queue.map((q) => <QueueRow key={q.material.id} material={q.material} deadline={q.deadline} targetDays={q.targetDays} />)}
          </Section>

          <Section
            title={t('dashboard.issues.title')}
            count={mine.length}
            empty={t('dashboard.issues.empty')}
            viewAll={<Link to="/issues" search={{ owner: viewer.name, status: 'open,in_progress' }}>{t('dashboard.viewAll')}</Link>}
          >
            {mine.map((i) => <IssueRow key={i.id} issue={i} raisedByMe={i.owner !== viewer.name} />)}
          </Section>

          <Section
            title={t('dashboard.submissions.title')}
            count={submissions.length}
            empty={t('dashboard.submissions.empty')}
            viewAll={submissions.length > 0 && <Link to="/materials" search={{ owner: viewer.name }}>{t('dashboard.viewAll')}</Link>}
            action={
              <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <Link to="/materials/new"><Plus className="size-3.5" />{t('page.newMaterial')}</Link>
              </Button>
            }
          >
            {submissions.map((m) => <SubmissionRow key={m.id} material={m} />)}
          </Section>
        </div>

        <WorkspacePanel materials={allMaterials} issues={allIssues} />
      </div>
    </div>
  )
}

/** One short list with a heading, a count, and a link to the full list. Empty sections stay as one quiet line. */
function Section({ title, count, note, empty, viewAll, action, children }: {
  title: string
  count: number
  /** A short warning beside the count, for example how many are late. */
  note?: React.ReactNode
  empty: string
  viewAll?: React.ReactNode
  /** A button at the end of the heading row, for example "New submission". */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        {note}
        <span className="ml-auto" />
        {viewAll && <span className="text-xs font-medium text-primary hover:underline">{viewAll}</span>}
        {action}
      </div>
      {count > 0 ? (
        <ul className="overflow-hidden rounded-lg border">{children}</ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-3 text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

/** How long a review has left before the group deadline. Late is red; today and tomorrow are amber. */
function DeadlineLabel({ deadline, targetDays }: { deadline: Date; targetDays: number }) {
  const { t } = useTranslation()
  const days = daysToDeadline(deadline)
  const tone = days < 0 ? 'font-medium text-risk-high' : days <= 1 ? 'font-medium text-risk-medium' : 'text-muted-foreground'
  const text =
    days < 0 ? t('dashboard.deadline.late', { count: -days })
      : days === 0 ? t('dashboard.deadline.today')
        : days === 1 ? t('dashboard.deadline.tomorrow')
          : t('dashboard.deadline.on', { date: formatDate(deadline, { month: 'short', day: 'numeric' }) })
  return <span title={t('dashboard.deadline.title', { date: formatDate(deadline), count: targetDays })} className={tone}>{text}</span>
}

function QueueRow({ material: m, deadline, targetDays }: { material: Material; deadline: Date; targetDays: number }) {
  const { t } = useTranslation()
  return (
    <li className="border-b last:border-b-0">
      <Link to="/materials/$materialId" params={{ materialId: m.id }} className={listRowClass}>
        <ChannelIcon channel={m.channel} className="w-4 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium">{m.title}</span>
          {m.affiliate && <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground max-md:hidden">{m.affiliate}</span>}
        </span>
        <span className="w-24 shrink-0 max-sm:hidden"><StatusPill status={m.status} /></span>
        <GroupApprovals groups={m.groups} className="w-52 shrink-0 justify-end overflow-hidden max-xl:hidden" />
        <span className="w-28 shrink-0 text-right text-xs tabular-nums"><DeadlineLabel deadline={deadline} targetDays={targetDays} /></span>
        <span title={t('dashboard.owner', { name: m.owner })}><PersonAvatar name={m.owner} className="shrink-0" /></span>
      </Link>
    </li>
  )
}

function IssueRow({ issue: i, raisedByMe }: { issue: Issue; raisedByMe: boolean }) {
  const { t } = useTranslation()
  const overdue = isOverdue(i)
  return (
    <li className="border-b last:border-b-0">
      <Link to="/issues/$issueId" params={{ issueId: i.id }} className={listRowClass}>
        <SeverityLabel level={i.severity} className="w-16 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium">{i.title}</span>
          {/* Issues I raised but someone else owns: I follow them, they fix them. */}
          {raisedByMe && <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground max-md:hidden">{t('dashboard.issues.raised')}</span>}
        </span>
        <span className="w-24 shrink-0 max-sm:hidden"><IssueStatusPill status={i.status} /></span>
        <span className="flex w-56 shrink-0 items-center gap-2 text-xs text-muted-foreground max-xl:hidden">
          <ChannelIcon channel={i.material.channel} className="size-3.5 shrink-0" />
          <span className="truncate">{i.material.title}</span>
        </span>
        <span className={cn('w-28 shrink-0 text-right text-xs tabular-nums', overdue ? 'font-medium text-risk-high' : 'text-muted-foreground')}>
          {overdue ? t('issues.overdueShort', { date: formatDate(i.dueAt, { month: 'short', day: 'numeric' }) }) : t('issues.dueOn', { date: formatDate(i.dueAt, { month: 'short', day: 'numeric' }) })}
        </span>
        <span title={t('dashboard.owner', { name: i.owner })}><PersonAvatar name={i.owner} className="shrink-0" /></span>
      </Link>
    </li>
  )
}

function SubmissionRow({ material: m }: { material: Material }) {
  return (
    <li className="border-b last:border-b-0">
      <Link to="/materials/$materialId" params={{ materialId: m.id }} className={listRowClass}>
        <ChannelIcon channel={m.channel} className="w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
        <span className="w-32 shrink-0 max-sm:hidden"><StatusPill status={m.status} /></span>
        <GroupApprovals groups={m.groups} className="w-52 shrink-0 justify-end overflow-hidden max-xl:hidden" />
        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{formatRelativeTime(m.updatedAt)}</span>
      </Link>
    </li>
  )
}

/**
 * Right side: problems in the whole workspace that a compliance person should know about today,
 * each one a link to the filtered list. Approvals that expire soon need a renewal before they lapse.
 */
function WorkspacePanel({ materials, issues }: { materials: Material[]; issues: Issue[] }) {
  const { t } = useTranslation()
  const liveProblems = materials.filter((m) => LIVE_PROBLEMS.includes(m.liveStatus)).length
  const overdue = issues.filter(isOverdue).length
  const openHigh = issues.filter((i) => i.status !== 'resolved' && i.severity === 'high').length
  const expiring = materials
    .filter((m) => m.expiresAt && daysUntil(m.expiresAt) > 0 && daysUntil(m.expiresAt) <= 30)
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))


  return (
    <aside className="grid content-start gap-6">
      <section className="grid gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('dashboard.workspace.title')}</h2>
        <ul className="overflow-hidden rounded-lg border">
          <li className="border-b">
            <Link to="/materials" search={{ live: LIVE_PROBLEMS.join(',') }} className={statClass}>
              <Stat label={t('dashboard.workspace.liveProblems')} count={liveProblems} />
            </Link>
          </li>
          <li className="border-b">
            <Link to="/issues" search={{ due: 'overdue' }} className={statClass}>
              <Stat label={t('dashboard.workspace.overdueIssues')} count={overdue} />
            </Link>
          </li>
          <li>
            <Link to="/issues" search={{ status: 'open,in_progress', severity: 'high' }} className={statClass}>
              <Stat label={t('dashboard.workspace.highIssues')} count={openHigh} />
            </Link>
          </li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('dashboard.workspace.expiring')}</h2>
        {expiring.length ? (
          <ul className="grid gap-2">
            {expiring.map((m) => (
              <li key={m.id}>
                <Link to="/materials/$materialId" params={{ materialId: m.id }} className="group grid gap-0.5">
                  <span className="flex items-start gap-2 text-sm font-medium group-hover:underline">
                    <ChannelIcon channel={m.channel} className="mt-0.5 size-3.5 shrink-0" />
                    {m.title}
                  </span>
                  <span className="pl-5.5 text-xs text-risk-medium">{t('materials.expiresOn', { date: formatDate(m.expiresAt!) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t('dashboard.workspace.noneExpiring')}</p>
        )}
      </section>
    </aside>
  )
}

const statClass = 'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/** One workspace count. A count above zero is red, so problems stand out. */
function Stat({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span className="flex-1">{label}</span>
      <span className={cn('font-semibold tabular-nums', count > 0 ? 'text-risk-high' : 'text-muted-foreground')}>{count}</span>
      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6">
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-6 w-96 max-w-full" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}
