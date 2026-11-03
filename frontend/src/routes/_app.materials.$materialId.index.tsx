import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRightLeft, Check, ChevronDown, ChevronLeft, Clock, CircleAlert, Ellipsis, ImageIcon, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeadlineLabel } from '@/components/dashboard/deadline-label'
import { RaiseIssueDialog } from '@/components/issues/raise-issue-dialog'
import { FindingCard } from '@/components/review/finding-card'
import { FlaggedText } from '@/components/review/flagged-text'
import { FlagsPanel } from '@/components/review/flags-panel'
import { approvedByViewer, groupsForViewer } from '@/components/review/decide'
import { DecisionDialog } from '@/components/review/decision-dialog'
import { HistoryTab } from '@/components/review/history-tab'
import { LiveTab } from '@/components/review/live-tab'
import { TrackedText } from '@/components/review/tracked-text'
import { fileUrl, useMaterialDetail, versionFields, type CommentAnchor, type Decision, type Finding, type MaterialDetail } from '@/components/review/material-detail-data'
import { SaveError } from '@/components/save-error'
import { hasRole } from '@/components/settings/user-data'
import { api } from '@/lib/api'
import { useViewer } from '@/lib/session'
import { useSave } from '@/lib/use-save'
import { useQueryClient } from '@tanstack/react-query'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'

const tabs = ['content', 'history', 'live'] as const
type MaterialTab = (typeof tabs)[number]

// The tab and the viewed version are in the URL (?tab=history, ?v=1), so a link opens the same view.
export const Route = createFileRoute('/_app/materials/$materialId/')({
  validateSearch: (search: Record<string, unknown>): { tab?: MaterialTab; v?: number } => {
    const tab = tabs.find((t) => t === search.tab)
    const v = Number(search.v)
    return { tab: tab && tab !== 'content' ? tab : undefined, v: Number.isInteger(v) && v > 0 ? v : undefined }
  },
  component: MaterialPage,
})

function MaterialPage() {
  const { t } = useTranslation()
  const { materialId } = Route.useParams()
  const { tab = 'content', v } = Route.useSearch()
  const navigate = Route.useNavigate()
  const list = useMaterials()
  const detail = useMaterialDetail(materialId)
  // TODO: the detail API should return the summary fields too, so the page needs one request.
  const material = list.data?.find((m) => m.id === materialId)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [raising, setRaising] = useState(false)

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
      <Header material={material} detail={detail.data ?? null} onDecide={setDecision} onRaiseIssue={() => setRaising(true)} />
      {/* Above the tabs, so a flag for re-review shows on every tab (PRD F7). */}
      {detail.data && <FlagsPanel detail={detail.data} />}
      <RaiseIssueDialog
        material={material}
        open={raising}
        onClose={() => setRaising(false)}
      />
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
          {detail.data ? (
            <ReviewView
              material={material}
              detail={detail.data}
              version={detail.data.versions.some((x) => x.number === v) ? v! : detail.data.version}
              onVersion={(n) => navigate({ search: { v: n === detail.data?.version ? undefined : n }, replace: true })}
            />
          ) : <NoSeededContent />}
        </TabsContent>
        <TabsContent value="history" className="pt-4">{detail.data ? <HistoryTab detail={detail.data} /> : <NoSeededContent />}</TabsContent>
        <TabsContent value="live" className="pt-4">{detail.data ? <LiveTab material={material} detail={detail.data} /> : <NoSeededContent />}</TabsContent>
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
function Header({ material: m, detail, onDecide, onRaiseIssue }: {
  material: Material
  detail: MaterialDetail | null
  onDecide: (d: Decision) => void
  onRaiseIssue: () => void
}) {
  const viewer = useViewer()
  const { t } = useTranslation()
  const label = useOptionLabel()
  // Decision buttons show only to Reviewers in a required group that still waits, while In review (PRD F5).
  // R1: nobody approves a version they submitted.
  const canDecide = m.status === 'in_review' && !!detail && detail.submittedBy !== viewer.name && groupsForViewer(detail, viewer).length > 0
  const canRetract = !!detail && approvedByViewer(detail, viewer).length > 0
  // PRD section 4: Submitters and affiliates send new versions; Reviewers and higher raise issues (F12).
  const canSubmit = viewer.role === 'affiliate' || hasRole(viewer.role, 'submitter')
  const canRaise = hasRole(viewer.role, 'reviewer')

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
            {m.approvalId && <code>{m.approvalId}</code>}
            {m.expiresAt && <span>{t('materials.expiresOn', { date: formatDate(m.expiresAt) })}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canDecide ? <DecisionButtons onDecide={onDecide} /> : canSubmit && (
            <Button asChild variant="outline">
              <Link to="/materials/$materialId/new-version" params={{ materialId: m.id }}><Upload />{t('page.newVersion')}</Link>
            </Button>
          )}
          {(canDecide || canRetract || canRaise) && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('review.moreActions')}><Ellipsis /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canDecide && <DropdownMenuItem onSelect={() => onDecide('escalate')}>{t('review.decision.escalate')}</DropdownMenuItem>}
              {canRetract && <DropdownMenuItem onSelect={() => onDecide('retract')}>{t('review.decision.retract')}</DropdownMenuItem>}
              {canRaise && <DropdownMenuItem onSelect={onRaiseIssue}>{t('review.raiseIssue')}</DropdownMenuItem>}
              {canDecide && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/materials/$materialId/new-version" params={{ materialId: m.id }}>{t('page.newVersion')}</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>}
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
function ReviewView({ material, detail, version, onVersion }: {
  material: Material
  detail: MaterialDetail
  version: number
  onVersion: (v: number) => void
}) {
  const [active, setActive] = useState<string | null>(null)
  // Text selected in the content, for the next comment (PRD F5: comments link to a text section)
  const [anchor, setAnchor] = useState<CommentAnchor | null>(null)
  const open = detail.findings.filter((f) => f.status === 'open')
  const numbers = new Map(open.map((f, i) => [f.id, i + 1]))
  const isCurrent = version === detail.version

  const focus = (id: string, target: 'mark' | 'finding') => {
    if (!isCurrent) onVersion(detail.version)
    setActive(id)
    // Wait one frame, so the marks exist again after switching back to the current version.
    requestAnimationFrame(() => document.getElementById(`${target}-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <ContentPanel
            material={material}
            detail={detail}
            version={version}
            onVersion={onVersion}
            numbers={numbers}
            active={active}
            onMark={(id) => focus(id, 'finding')}
            onSelectText={setAnchor}
          />
          <Conversation detail={detail} anchor={anchor} onClearAnchor={() => setAnchor(null)} />
        </div>
        <FindingsColumn findings={detail.findings} numbers={numbers} active={active} onFinding={(id) => focus(id, 'mark')} />
      </div>
      <ReviewPanel material={material} detail={detail} onFinding={(id) => focus(id, 'finding')} />
    </div>
  )
}

/** "Version 1 of 2 · Changes requested · Oct 30, 2026", for the version menus. */
function VersionOption({ v, count }: { v: MaterialDetail['versions'][number]; count: number }) {
  const { t } = useTranslation()
  return (
    <>
      <span className="font-medium">{t('review.versionOf', { version: v.number, count })}</span>
      <span className="text-muted-foreground">
        {' · '}
        {v.current ? t('review.current') : v.outcome ? t(`status.${v.outcome}`) : ''}
        {' · '}
        {formatDate(v.submittedAt)}
      </span>
    </>
  )
}

function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn('text-xs font-semibold tracking-wide text-muted-foreground uppercase', className)}>{children}</h2>
}

/**
 * The submitted content, field by field. The version menu in the panel header picks the version,
 * like version history in Google Docs. "Show changes" marks what changed since the version before it.
 * Finding marks show only on the current version, because findings belong to it.
 */
function ContentPanel({ material, detail, version, onVersion, numbers, active, onMark, onSelectText }: {
  material: Material
  detail: MaterialDetail
  version: number
  onVersion: (v: number) => void
  numbers: Map<string, number>
  active: string | null
  onMark: (id: string) => void
  onSelectText: (anchor: CommentAnchor) => void
}) {
  const { t } = useTranslation()
  const label = useOptionLabel()
  // The version to compare with. null shows the viewed version alone.
  const [compareTo, setCompareTo] = useState<number | null>(null)
  const severity = new Map(detail.findings.map((f) => [f.id, f.severity]))
  const kinds = new Map(detail.fields.map((f) => [f.label, f.kind]))

  const sorted = [...detail.versions].sort((a, b) => b.number - a.number)
  const viewed = detail.versions.find((v) => v.number === version) ?? sorted[0]
  const compared = compareTo !== version ? detail.versions.find((v) => v.number === compareTo) : undefined
  const isCurrent = version === detail.version
  const tracking = !!compared
  const before = compared ? versionFields(detail, compared) : []
  const fields = viewed ? versionFields(detail, viewed) : []

  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2 font-semibold">
          <ChannelIcon channel={material.channel} className="size-3.5" />
          {label('channel', material.channel)}
        </span>
        {/* The viewed version, then the version to compare with. The arrows between them swap the two. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Select value={String(version)} onValueChange={(v) => onVersion(Number(v))}>
            <SelectTrigger size="sm" className="h-7 w-auto gap-1.5 bg-background text-xs" aria-label={t('review.versionMenu')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {sorted.map((v) => (
                <SelectItem key={v.number} value={String(v.number)} className="text-xs">
                  <VersionOption v={v} count={detail.versionCount} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sorted.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                disabled={!compared}
                onClick={() => {
                  if (!compared) return
                  setCompareTo(version)
                  onVersion(compared.number)
                }}
                aria-label={t('review.changes.swap')}
                title={t('review.changes.swap')}
              >
                <ArrowRightLeft />
              </Button>
              <Select value={compared ? String(compared.number) : 'none'} onValueChange={(v) => setCompareTo(v === 'none' ? null : Number(v))}>
                <SelectTrigger size="sm" className="h-7 w-auto gap-1.5 bg-background text-xs" aria-label={t('review.changes.compareTo')}>
                  <span className="text-muted-foreground">{t('review.changes.compareTo')}:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="none" className="text-xs">{t('review.changes.none')}</SelectItem>
                  {sorted.filter((v) => v.number !== version).map((v) => (
                    <SelectItem key={v.number} value={String(v.number)} className="text-xs">
                      <VersionOption v={v} count={detail.versionCount} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </div>

      {!isCurrent && viewed && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-info-soft px-3 py-2 text-xs text-info">
          {t('review.changes.oldVersion', {
            version: viewed.number,
            name: viewed.submittedBy,
            date: formatDate(viewed.submittedAt),
            current: detail.version,
          })}
          <button type="button" onClick={() => onVersion(detail.version)} className="font-semibold underline underline-offset-2">
            {t('review.changes.backToCurrent')}
          </button>
        </p>
      )}

      {/* Selecting text in one field of the current version makes the next comment about that text. */}
      <dl className="grid gap-4 p-4" onMouseUp={() => !tracking && isCurrent && selectedText(onSelectText)} onKeyUp={() => !tracking && isCurrent && selectedText(onSelectText)}>
        {fields.map((field) => {
          const isImage = kinds.get(field.label) === 'image'
          const segments = detail.fields.find((f) => f.label === field.label)?.segments
          const prevText = before.find((f) => f.label === field.label)?.text ?? ''
          return (
            <div key={field.label} className="grid gap-1">
              <dt className="text-xs font-medium text-muted-foreground">
                {field.label}
                {tracking && prevText === field.text && <span className="font-normal"> · {t('review.changes.unchanged')}</span>}
              </dt>
              <dd className="text-base leading-relaxed">
                {isImage && (
                  <div className="mb-2 grid aspect-[1.91/1] max-w-md place-items-center rounded-md border bg-muted text-muted-foreground">
                    <ImageIcon className="size-6" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                )}
                {isImage && <span className="mr-1 text-xs text-muted-foreground">{t('review.textInImage')}</span>}
                <span data-field={field.label}>
                  {tracking ? (
                    <TrackedText before={prevText} after={field.text} />
                  ) : isCurrent && segments ? (
                    segments.map((s, i) =>
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
                    )
                  ) : (
                    field.text
                  )}
                </span>
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

/** The text selected inside one field of the content, if any. A selection across fields counts as none. */
function selectedText(onSelect: (anchor: CommentAnchor) => void) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return
  const range = selection.getRangeAt(0)
  const fieldOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('[data-field]')
  const field = fieldOf(range.startContainer)
  // Without the finding numbers that the marks show
  const fragment = range.cloneContents()
  fragment.querySelectorAll('sup').forEach((sup) => sup.remove())
  const text = (fragment.textContent ?? '').trim()
  if (field && field === fieldOf(range.endContainer) && text) onSelect({ field: field.getAttribute('data-field') ?? '', text: text.slice(0, 2000) })
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

/**
 * Comments from people, oldest first, like a pull request conversation.
 * Reviewers comment, Submitters and affiliates reply; Viewers only read (PRD section 4). TODO: threaded replies.
 */
function Conversation({ detail, anchor, onClearAnchor }: { detail: MaterialDetail; anchor: CommentAnchor | null; onClearAnchor: () => void }) {
  const viewer = useViewer()
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const save = useSave(() => {
    setBody('')
    onClearAnchor()
  })
  const canComment = viewer.role === 'affiliate' || hasRole(viewer.role, 'submitter')
  const post = () =>
    save.run(async () => {
      const saved = await api<MaterialDetail>('POST', `/materials/${detail.id}/comments`, { body, anchor: anchor ?? undefined })
      queryClient.setQueryData(['material-detail', detail.id], saved)
    })
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
              {c.anchor && (
                <blockquote className="w-fit border-l-2 pl-2 text-xs text-muted-foreground">
                  <span className="font-medium">{c.anchor.field}:</span> {c.anchor.text}
                </blockquote>
              )}
              {c.body && <p className="whitespace-pre-line">{c.body}</p>}
            </div>
          </li>
        ))}
      </ol>
      {canComment && (
        <form className="flex gap-2.5" onSubmit={(e) => { e.preventDefault(); void post() }}>
          <PersonAvatar name={viewer.name} />
          <div className="grid flex-1 justify-items-end gap-2">
            {anchor ? (
              <p className="flex w-full items-start gap-2 rounded-md border-l-2 border-primary bg-muted px-2 py-1 text-xs">
                <span className="line-clamp-2 min-w-0 flex-1">{t('review.commentOn', { text: anchor.text })}</span>
                <button type="button" onClick={onClearAnchor} aria-label={t('review.clearSelection')} title={t('review.clearSelection')} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </p>
            ) : (
              <p className="w-full text-xs text-muted-foreground">{t('review.commentSelectHint')}</p>
            )}
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder={t('review.commentPlaceholder')} aria-label={t('review.commentPlaceholder')} className="min-h-16" />
            <div className="w-full"><SaveError error={save.error} /></div>
            <Button type="submit" variant="outline" size="sm" disabled={!body.trim() || save.pending}>{t('review.comment')}</Button>
          </div>
        </form>
      )}
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
  const viewer = useViewer()
  const { t } = useTranslation()
  const failed = detail.checklist.filter((r) => r.result === 'fail').length

  return (
    <aside className="grid gap-6 lg:sticky lg:top-24">
      <section className="grid gap-2">
        <SectionHeading>{t('review.requiredGroups')}</SectionHeading>
        <ul className="grid gap-2.5">
          {detail.groups.map((g) => {
            const { icon: Icon, tone } = groupStateIcon[g.state]
            const mine = viewer.groups.includes(g.name)
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
                    {g.deadline && <> · <DeadlineLabel deadline={g.deadline} /></>}
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
          {detail.details.platformId && <Detail label={t('review.detail.platformId')}><code className="break-all">{detail.details.platformId}</code></Detail>}
          {detail.files.length > 0 && (
            <Detail label={t('review.detail.files')}>
              <ul className="grid gap-0.5">
                {detail.files.map((f) => (
                  <li key={f.id}><a href={fileUrl(f.id)} download={f.name} className="break-all font-medium text-primary hover:underline">{f.name}</a></li>
                ))}
              </ul>
            </Detail>
          )}
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
