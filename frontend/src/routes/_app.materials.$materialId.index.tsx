import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, ChevronDown, ChevronLeft, Clock, CircleAlert, Ellipsis, ImageIcon, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FindingCard } from '@/components/review/finding-card'
import { FlaggedText } from '@/components/review/flagged-text'
import { approvedByViewer, groupsForViewer } from '@/components/review/decide'
import { DecisionDialog } from '@/components/review/decision-dialog'
import { demoViewer, useMaterialDetail, type Decision, type Finding, type MaterialDetail } from '@/components/review/material-detail-data'
import { useMaterials, type Material } from '@/components/materials/material-data'
import { ChannelIcon, LiveStatusTag, PersonAvatar } from '@/components/materials/material-meta'
import { useOptionLabel } from '@/components/materials/use-option-label'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'

const tabs = ['content', 'versions', 'history', 'live'] as const
type MaterialTab = (typeof tabs)[number]

// The tab is in the URL (?tab=versions) so a link opens the right tab.
export const Route = createFileRoute('/_app/materials/$materialId/')({
  validateSearch: (search: Record<string, unknown>): { tab?: MaterialTab } => {
    const tab = tabs.find((t) => t === search.tab)
    return tab && tab !== 'content' ? { tab } : {}
  },
  component: MaterialPage,
})

function MaterialPage() {
  const { t } = useTranslation()
  const { materialId } = Route.useParams()
  const { tab = 'content' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const list = useMaterials()
  const detail = useMaterialDetail(materialId)
  // TODO: the detail API should return the summary fields too, so the page needs one request.
  const material = list.data?.find((m) => m.id === materialId)
  const [decision, setDecision] = useState<Decision | null>(null)

  if (list.isPending || detail.isPending) return <PageSkeleton />
  if (!material) {
    return (
      <div className="mx-auto grid max-w-7xl justify-items-start gap-3">
        <BackLink />
        <p className="font-medium">{t('review.notFound')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <Header material={material} detail={detail.data ?? null} onDecide={setDecision} />
      {detail.data && (
        <DecisionDialog decision={decision} detail={detail.data} materialId={material.id} onClose={() => setDecision(null)} />
      )}

      <Tabs
        value={tab}
        onValueChange={(value) =>
          navigate({ search: value === 'content' ? {} : { tab: value as MaterialTab }, replace: true })
        }
      >
        <TabsList>
          {tabs.map((id) => (
            <TabsTrigger key={id} value={id}>{t(`materialTabs.${id}`)}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="content" className="pt-4">
          {detail.data ? <ReviewView material={material} detail={detail.data} /> : <NoSeededContent />}
        </TabsContent>
        <TabsContent value="versions" className="pt-4 text-muted-foreground">{t('review.later.versions')}</TabsContent>
        <TabsContent value="history" className="pt-4 text-muted-foreground">{t('review.later.history')}</TabsContent>
        <TabsContent value="live" className="pt-4 text-muted-foreground">{t('review.later.live')}</TabsContent>
      </Tabs>
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/materials" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-3.5" />
      {t('nav.materials')}
    </Link>
  )
}

/** Title, statuses, one line of facts, and the actions that the viewer's role allows. */
function Header({ material: m, detail, onDecide }: { material: Material; detail: MaterialDetail | null; onDecide: (d: Decision) => void }) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  // Decision buttons show only to Reviewers in a required group that still waits, while In review (PRD F5).
  const canDecide = m.status === 'in_review' && !!detail && groupsForViewer(detail).length > 0
  const canRetract = !!detail && approvedByViewer(detail).length > 0

  return (
    <header className="grid gap-2">
      <BackLink />
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{m.title}</h1>
            <StatusPill status={m.status} />
            {m.liveStatus !== 'not_live' && <LiveStatusTag status={m.liveStatus} />}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><ChannelIcon channel={m.channel} className="size-3.5" />{label('channel', m.channel)}</span>
            <span>{label('product', m.product)}</span>
            <span className="flex items-center gap-1.5"><PersonAvatar name={m.owner} className="size-4 text-[8px]" />{m.owner}</span>
            {detail && <span>{t('review.versionOf', { version: detail.version, count: detail.versionCount })}</span>}
            {m.approvalId && <code>{m.approvalId}</code>}
            {m.expiresAt && <span>{t('materials.expiresOn', { date: formatDate(m.expiresAt) })}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canDecide ? <DecisionButtons onDecide={onDecide} /> : (
            <Button asChild variant="outline">
              <Link to="/materials/$materialId/new-version" params={{ materialId: m.id }}><Upload />{t('page.newVersion')}</Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('review.moreActions')}><Ellipsis /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canDecide && <DropdownMenuItem onSelect={() => onDecide('escalate')}>{t('review.decision.escalate')}</DropdownMenuItem>}
              {canRetract && <DropdownMenuItem onSelect={() => onDecide('retract')}>{t('review.decision.retract')}</DropdownMenuItem>}
              <DropdownMenuItem>{t('review.raiseIssue')}</DropdownMenuItem>
              {canDecide && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/materials/$materialId/new-version" params={{ materialId: m.id }}>{t('page.newVersion')}</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

/** Reject, Request changes, Approve (with a menu for Approve with conditions). Each opens the decision dialog. */
function DecisionButtons({ onDecide }: { onDecide: (d: Decision) => void }) {
  const { t } = useTranslation()
  return (
    <>
      <Button variant="destructive-outline" onClick={() => onDecide('reject')}>{t('review.decision.reject')}</Button>
      <Button variant="outline" onClick={() => onDecide('request_changes')}>{t('review.decision.requestChanges')}</Button>
      <div className="flex">
        <Button className="rounded-r-none" onClick={() => onDecide('approve')}>{t('review.decision.approve')}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" className="rounded-l-none border-l border-primary-strong" aria-label={t('review.decision.moreApprove')}>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onDecide('approve_conditions')}>{t('review.decision.approveWithConditions')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

/**
 * The review: content with flagged text, findings beside it, and the review panel on the right.
 * Click flagged text or a finding to link the two. Below xl the findings go under the content,
 * and below lg the review panel goes under everything.
 */
function ReviewView({ material, detail }: { material: Material; detail: MaterialDetail }) {
  const [active, setActive] = useState<string | null>(null)
  const open = detail.findings.filter((f) => f.status === 'open')
  const numbers = new Map(open.map((f, i) => [f.id, i + 1]))

  const focus = (id: string, target: 'mark' | 'finding') => {
    setActive(id)
    document.getElementById(`${target}-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <ContentPanel material={material} detail={detail} numbers={numbers} active={active} onMark={(id) => focus(id, 'finding')} />
          <Conversation detail={detail} />
        </div>
        <FindingsColumn findings={detail.findings} numbers={numbers} active={active} onFinding={(id) => focus(id, 'mark')} />
      </div>
      <ReviewPanel material={material} detail={detail} onFinding={(id) => focus(id, 'finding')} />
    </div>
  )
}

function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-xs font-semibold tracking-wide text-muted-foreground uppercase', className)}>{children}</h2>
}

/** The submitted content, field by field, as the platform will show it. */
function ContentPanel({ material, detail, numbers, active, onMark }: {
  material: Material
  detail: MaterialDetail
  numbers: Map<string, number>
  active: string | null
  onMark: (id: string) => void
}) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  const severity = new Map(detail.findings.map((f) => [f.id, f.severity]))

  return (
    <section className="rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-xs">
        <ChannelIcon channel={material.channel} className="size-3.5" />
        <span className="font-semibold">{label('channel', material.channel)}</span>
        <span className="text-muted-foreground">{t('review.versionOf', { version: detail.version, count: detail.versionCount })}</span>
      </div>
      <dl className="grid gap-4 p-4">
        {detail.fields.map((field) => (
          <div key={field.label} className="grid gap-1">
            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
            <dd className="text-base leading-relaxed">
              {field.kind === 'image' && (
                <div className="mb-2 grid aspect-[1.91/1] max-w-md place-items-center rounded-md border bg-muted text-muted-foreground">
                  <ImageIcon className="size-6" strokeWidth={1.5} aria-hidden="true" />
                </div>
              )}
              {field.kind === 'image' && <span className="mr-1 text-xs text-muted-foreground">{t('review.textInImage')}</span>}
              {field.segments.map((s, i) =>
                typeof s === 'string' ? (
                  <span key={i}>{s}</span>
                ) : (
                  <FlaggedText
                    key={i}
                    id={`mark-${s.finding}`}
                    severity={severity.get(s.finding) ?? 'medium'}
                    number={numbers.get(s.finding)}
                    active={active === s.finding}
                    onClick={() => onMark(s.finding)}
                    className="cursor-pointer scroll-mt-32"
                  >
                    {s.text}
                  </FlaggedText>
                ),
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function FindingsColumn({ findings, numbers, active, onFinding }: {
  findings: Finding[]
  numbers: Map<string, number>
  active: string | null
  onFinding: (id: string) => void
}) {
  const { t } = useTranslation()
  const open = findings.filter((f) => f.status === 'open')
  const outdated = findings.filter((f) => f.status === 'outdated')

  return (
    <section className="grid gap-2">
      <SectionHeading>{t('review.findings', { count: open.length })}</SectionHeading>
      {open.map((f) => (
        <FindingCard
          key={f.id}
          id={`finding-${f.id}`}
          number={numbers.get(f.id)}
          severity={f.severity}
          ruleId={f.ruleId}
          source={f.source}
          flaggedText={f.text}
          explanation={f.explanation}
          suggestion={f.suggestion}
          onClick={() => onFinding(f.id)}
          className={cn('scroll-mt-32 cursor-pointer transition-shadow', active === f.id && 'ring-2 ring-primary')}
        />
      ))}
      {outdated.length > 0 && (
        <>
          <SectionHeading className="pt-2">{t('review.outdated', { count: outdated.length })}</SectionHeading>
          {outdated.map((f) => (
            <FindingCard key={f.id} severity={f.severity} ruleId={f.ruleId} source={f.source} status="outdated" flaggedText={f.text} explanation={f.explanation} />
          ))}
        </>
      )}
    </section>
  )
}

/** Comments from people, oldest first, like a pull request conversation. TODO: post and reply. */
function Conversation({ detail }: { detail: MaterialDetail }) {
  const { t } = useTranslation()
  return (
    <section className="grid gap-3">
      <SectionHeading>{t('review.comments', { count: detail.comments.length })}</SectionHeading>
      <ol className="grid gap-3">
        {detail.comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <PersonAvatar name={c.author} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-semibold text-foreground">{c.author}</span>
                <span className="text-muted-foreground">{c.role}</span>
                <span className="text-muted-foreground">{formatRelativeTime(c.at)}</span>
              </p>
              {c.decision && (
                <p className={cn('w-fit rounded-sm px-1.5 py-0.5 text-xs font-semibold', decisionTone[c.decision])}>
                  {t(`review.decided.${c.decision}`)}
                </p>
              )}
              {c.body && <p className="whitespace-pre-line">{c.body}</p>}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex gap-2.5">
        <PersonAvatar name={demoViewer.name} />
        <div className="grid flex-1 justify-items-end gap-2">
          <Textarea placeholder={t('review.commentPlaceholder')} aria-label={t('review.commentPlaceholder')} className="min-h-16" />
          <Button variant="outline" size="sm">{t('review.comment')}</Button>
        </div>
      </div>
    </section>
  )
}

/** Decision entries in the conversation use the same meaning colors as the status pills. */
const decisionTone: Record<Decision, string> = {
  approve: 'bg-risk-low-soft text-risk-low',
  approve_conditions: 'bg-risk-low-soft text-risk-low',
  request_changes: 'bg-risk-medium-soft text-risk-medium',
  reject: 'bg-risk-high-soft text-risk-high',
  escalate: 'bg-info-soft text-info',
  retract: 'bg-neutral-soft text-neutral',
}

const groupStateIcon = {
  approved: { icon: Check, tone: 'text-risk-low' },
  waiting: { icon: Clock, tone: 'text-muted-foreground' },
  changes: { icon: CircleAlert, tone: 'text-risk-medium' },
  rejected: { icon: X, tone: 'text-risk-high' },
} as const

/** Right side: who must approve, the checklist, and the submission details. */
function ReviewPanel({ material: m, detail, onFinding }: { material: Material; detail: MaterialDetail; onFinding: (id: string) => void }) {
  const { t } = useTranslation()
  const failed = detail.checklist.filter((r) => r.result === 'fail').length

  return (
    <aside className="grid gap-6 lg:sticky lg:top-24">
      <section className="grid gap-2">
        <SectionHeading>{t('review.requiredGroups')}</SectionHeading>
        <ul className="grid gap-2.5">
          {detail.groups.map((g) => {
            const { icon: Icon, tone } = groupStateIcon[g.state]
            const mine = demoViewer.groups.includes(g.name)
            return (
              <li key={g.name} className="flex gap-2">
                <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} strokeWidth={2.25} aria-hidden="true" />
                <div className="grid gap-0.5">
                  <p className="flex items-center gap-1.5 font-medium">
                    {g.name}
                    {mine && <span className="rounded-sm bg-primary-soft px-1 text-[11px] font-semibold text-primary-strong">{t('review.yourGroup')}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.state !== 'waiting' && g.by && g.at
                      ? t(`review.groupBy.${g.state}`, { name: g.by, time: formatRelativeTime(g.at) })
                      : t(`materials.groupStateShort.${g.state}`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.escalatedBy
                      ? t('review.escalatedBy', { name: g.escalatedBy, reason: g.reason })
                      : t('review.requiredBecause', { reason: g.reason })}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {detail.conditions && (
        <section className="grid gap-2">
          <SectionHeading>{t('review.conditions')}</SectionHeading>
          <p className="rounded-md border-l-[3px] border-l-primary bg-primary-soft px-3 py-2 text-xs whitespace-pre-line">{detail.conditions}</p>
        </section>
      )}

      <section className="grid gap-2">
        <SectionHeading>{t('review.checklist', { failed, passed: detail.checklist.length - failed })}</SectionHeading>
        <ul className="grid gap-px overflow-hidden rounded-lg border bg-border">
          {detail.checklist.map((r) => {
            const fail = r.result === 'fail'
            const row = (
              <>
                {fail
                  ? <X className="mt-0.5 size-3.5 shrink-0 text-risk-high" strokeWidth={2.5} aria-label={t('review.fail')} />
                  : <Check className="mt-0.5 size-3.5 shrink-0 text-risk-low" strokeWidth={2.5} aria-label={t('review.pass')} />}
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-xs">{r.title}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <code>{r.ruleId}</code>
                    <span>·</span>
                    <span>{t(`review.layer.${r.layer}`)}</span>
                  </span>
                </span>
              </>
            )
            return (
              <li key={r.ruleId} className="bg-background">
                {fail && r.finding ? (
                  <button type="button" onClick={() => onFinding(r.finding!)} className="flex w-full gap-2 px-2.5 py-2 text-left hover:bg-muted">
                    {row}
                  </button>
                ) : (
                  <div className="flex gap-2 px-2.5 py-2" title={r.note}>{row}</div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="grid gap-2">
        <SectionHeading>{t('review.details')}</SectionHeading>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <Detail label={t('review.detail.targetStates')}>{detail.details.targetStates}</Detail>
          {detail.details.launchDate && <Detail label={t('review.detail.dates')}>{formatDate(detail.details.launchDate)} – {detail.details.endDate ? formatDate(detail.details.endDate) : '—'}</Detail>}
          {detail.details.destinationUrl && <Detail label={t('review.detail.destination')}><span className="break-all">{detail.details.destinationUrl}</span></Detail>}
          {detail.details.metaAdId && <Detail label={t('review.detail.platformId')}><code className="break-all">{detail.details.metaAdId}</code></Detail>}
          <Detail label={t('review.detail.path')}>{t(`review.path.${detail.path}`)}</Detail>
          <Detail label={t('review.detail.submitted')}>{t('review.submittedBy', { name: detail.submittedBy, time: formatRelativeTime(detail.submittedAt) })}</Detail>
          {m.affiliate && <Detail label={t('materials.field.affiliate')}>{m.affiliate}</Detail>}
        </dl>
      </section>
    </aside>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function NoSeededContent() {
  const { t } = useTranslation()
  return (
    <div className="grid justify-items-start gap-2 rounded-lg border border-dashed p-6">
      <p className="font-medium">{t('review.noSeed')}</p>
      <Link
        to="/materials/$materialId"
        params={{ materialId: '01a112a1-4000-7d42-94be-d09364e3b51d' }}
        className="text-primary hover:underline"
      >
        {t('review.noSeedLink')}
      </Link>
    </div>
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
