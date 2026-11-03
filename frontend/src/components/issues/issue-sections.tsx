import { Link } from '@tanstack/react-router'
import { Bot, Check, ChevronDown, Circle, CircleAlert, ExternalLink, Pause, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LiveStatusTag, ChannelIcon, PersonAvatar } from '@/components/materials/material-meta'
import type { Material } from '@/components/materials/material-data'
import { systemActors } from '@/components/review/system-actors'
import { TrackedFields } from '@/components/review/tracked-text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SeverityLabel } from '@/components/ui/risk-tag'
import { StatusPill } from '@/components/ui/status-pill'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatDateTime, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'
import { useViewer } from '@/lib/session'
import { useSave } from '@/lib/use-save'
import { SaveError } from '@/components/save-error'
import { canManageIssue, isOverdue, type Issue, type IssueAction, type IssueDetail } from './issue-data'
import { IssueStatusPill } from './issue-meta'
import { useIssueUpdate } from './issue-update'

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
}

/**
 * The live content as monitoring last saw it, with tracked changes against the approved version.
 * A match by similarity gets a warning, because it can be the wrong material (PRD F10).
 */
export function LiveContent({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation()
  const item = detail.liveItem
  if (!item) return null

  return (
    <section className="grid gap-3">
      <SectionHeading>{t('issue.live.heading')}</SectionHeading>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{item.connector}</span>
        {item.externalId && <span>{t('issue.live.platformId')} <code>{item.externalId}</code></span>}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline">
            <span className="truncate">{item.url.replace(/^https?:\/\//, '')}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
          </a>
        )}
        <span>{t('issue.live.checked', { time: formatRelativeTime(item.checkedAt) })}</span>
        {item.paused && (
          <span className="inline-flex items-center gap-1 font-medium text-foreground"><Pause className="size-3" aria-hidden="true" />{t('issue.live.paused')}</span>
        )}
      </p>

      {item.match === 'similarity' && (
        <p className="flex items-start gap-2 rounded-md border border-risk-medium/40 bg-risk-medium-soft px-3 py-2 text-xs">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-risk-medium" aria-hidden="true" />
          <span>{t('issue.live.similarity', { percent: Math.round((item.similarity ?? 0) * 100) })}</span>
        </p>
      )}

      {detail.condition && (
        <p className="flex items-start gap-2 text-sm">
          <X className="mt-0.5 size-4 shrink-0 text-risk-high" strokeWidth={2.5} aria-hidden="true" />
          <span><span className="font-medium">{t('issue.live.conditionBroken')}</span> {detail.condition}</span>
        </p>
      )}

      <div className="grid gap-3 rounded-lg border p-4">
        {detail.approved ? (
          <>
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t('issue.live.comparedTo', { version: detail.approved.version, approvalId: detail.approved.approvalId })}</span>
              <span className="flex items-center gap-3">
                <del className="decoration-muted-foreground/70">{t('issue.live.legendRemoved')}</del>
                <ins className="rounded-[2px] bg-primary-soft text-primary-strong decoration-primary underline-offset-2">{t('issue.live.legendAdded')}</ins>
              </span>
            </p>
            <TrackedFields before={detail.approved.fields} after={item.fields} />
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('issue.live.noApproved')}</p>
            <dl className="grid gap-4">
              {item.fields.map((f) => (
                <div key={f.label} className="grid gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
                  <dd className="text-base leading-relaxed">{f.text}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </section>
  )
}

/** The remediation steps (PRD F12), each with the one button that does it. */
export function ActionList({ issue, detail }: { issue: Issue; detail: IssueDetail }) {
  const { t } = useTranslation()
  // A raised issue starts with no suggested steps; the owner fixes it and resolves it.
  if (detail.actions.length === 0) return null
  const done = detail.actions.filter((a) => a.done).length

  return (
    <section className="grid gap-3">
      <SectionHeading>{t('issue.actions.heading', { done, count: detail.actions.length })}</SectionHeading>
      <ol className="overflow-hidden rounded-lg border">
        {detail.actions.map((a) => (
          <ActionRow key={a.id} action={a} issue={issue} detail={detail} />
        ))}
      </ol>
    </section>
  )
}

function ActionRow({ action: a, issue, detail }: { action: IssueAction; issue: Issue; detail: IssueDetail }) {
  const { t } = useTranslation()
  const viewer = useViewer()
  const { completeAction } = useIssueUpdate(issue.id)
  const { pending, error, run } = useSave(() => undefined)
  const [editing, setEditing] = useState(false)
  const resolved = issue.status === 'resolved'

  let control: React.ReactNode = null
  // Only the owner or a Manager runs a step (PRD F12); the server checks it too.
  if (!a.done && !resolved && canManageIssue(viewer, issue)) {
    if (a.kind === 'new_version' && issue.material) {
      control = (
        <Button asChild variant="outline" size="sm">
          <Link to="/materials/$materialId/new-version" params={{ materialId: issue.material.id }}><Upload />{t('issue.actions.upload')}</Link>
        </Button>
      )
    } else if (a.kind === 'notice' && detail.notice) {
      control = (
        <Button variant={editing ? 'secondary' : 'outline'} size="sm" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {t('issue.actions.reviewDraft')}<ChevronDown className={cn('transition-transform', editing && 'rotate-180')} />
        </Button>
      )
    } else {
      control = (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void run(() => completeAction(a.id))}>
          {t('issue.actions.markDone')}
        </Button>
      )
    }
  }

  return (
    <li className="border-b last:border-b-0">
      <div className="flex items-start gap-3 px-3 py-2.5">
        {a.done
          ? <Check className="mt-0.5 size-4 shrink-0 text-risk-low" strokeWidth={2.5} aria-label={t('review.live.done')} />
          : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={t('review.live.todo')} />}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className={cn('font-medium', a.done && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{a.label}</p>
          {a.done && a.doneBy && a.doneAt && (
            <p className="text-xs text-muted-foreground">{t('issue.actions.doneBy', { who: a.doneBy, time: formatDateTime(a.doneAt) })}</p>
          )}
          {a.kind === 'notice' && detail.notice?.sentAt && (
            <p className="text-xs text-muted-foreground">{t('issue.notice.sentTo', { to: detail.notice.to })}</p>
          )}
        </div>
        {control}
      </div>
      {error && <div className="px-3 pb-2.5 sm:pl-10"><SaveError error={error} /></div>}
      {editing && detail.notice && !a.done && <NoticeEditor issueId={issue.id} notice={detail.notice} onDone={() => setEditing(false)} />}
    </li>
  )
}

/** The AI draft of the notice. A person reads it, edits it, and sends it; the tool never sends it alone (PRD F12). */
function NoticeEditor({ issueId, notice, onDone }: { issueId: string; notice: NonNullable<IssueDetail['notice']>; onDone: () => void }) {
  const { t } = useTranslation()
  const { sendNotice } = useIssueUpdate(issueId)
  const { pending, error, run } = useSave(onDone)
  const [subject, setSubject] = useState(notice.subject)
  const [body, setBody] = useState(notice.body)

  return (
    <form
      className="grid gap-3 border-t bg-muted/40 px-3 py-3 sm:pl-10"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => sendNotice(subject.trim(), body.trim()))
      }}
    >
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Bot className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        {t('issue.notice.aiNote')}
      </p>
      <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('issue.notice.to')}</dt>
        <dd>{notice.to}</dd>
        {notice.cc && (
          <>
            <dt className="text-muted-foreground">{t('issue.notice.cc')}</dt>
            <dd>{notice.cc}</dd>
          </>
        )}
      </dl>
      <div className="grid gap-1.5">
        <Label htmlFor="notice-subject">{t('issue.notice.subject')}</Label>
        <Input id="notice-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="bg-background" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="notice-body">{t('issue.notice.body')}</Label>
        <Textarea id="notice-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="bg-background leading-relaxed" />
      </div>
      <SaveError error={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t('issue.notice.cancel')}</Button>
        <Button type="submit" size="sm" disabled={!subject.trim() || !body.trim() || pending}>{t('issue.notice.send')}</Button>
      </div>
    </form>
  )
}

/** Events and comments in one list, oldest first. Append-only, so there are no edit controls. */
export function Activity({ issueId, detail }: { issueId: string; detail: IssueDetail }) {
  const { t } = useTranslation()
  const viewer = useViewer()
  const { comment } = useIssueUpdate(issueId)
  const [text, setText] = useState('')
  const { pending, error, run } = useSave(() => setText(''))
  const events = [...detail.activity].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <section className="grid gap-3">
      <SectionHeading>{t('issue.activity.heading')}</SectionHeading>
      <ol className="grid gap-3">
        {events.map((e, i) => {
          const Icon = systemActors[e.actor]
          return (
            <li key={i} className="flex gap-2.5">
              {Icon ? (
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" /></span>
              ) : (
                <PersonAvatar name={e.actor} />
              )}
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-semibold">{e.actor}</span>
                  <time dateTime={e.at} title={formatDateTime(e.at)} className="text-muted-foreground">{formatRelativeTime(e.at)}</time>
                </p>
                <p className={cn('whitespace-pre-line', !e.comment && 'text-muted-foreground')}>{e.text}</p>
              </div>
            </li>
          )
        })}
      </ol>
      {/* Viewers only read (PRD section 4). */}
      {viewer.role !== 'viewer' && <form
        className="flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void run(() => comment(text.trim()))
        }}
      >
        <span className="size-6 shrink-0" />
        <div className="grid flex-1 justify-items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('review.commentPlaceholder')}
            aria-label={t('review.commentPlaceholder')}
            className="min-h-16"
          />
          <SaveError error={error} />
          <Button type="submit" variant="outline" size="sm" disabled={!text.trim() || pending}>{t('review.comment')}</Button>
        </div>
      </form>}
    </section>
  )
}

/** Right side: the issue's properties, then the linked material and the rule. */
export function IssuePanel({ issue: i, detail, material, sourceLabel }: { issue: Issue; detail: IssueDetail | null; material?: Material; sourceLabel: string }) {
  const { t } = useTranslation()
  const overdue = isOverdue(i)

  return (
    <aside className="grid content-start gap-6 lg:sticky lg:top-16">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">{t('issues.field.status')}</dt>
        <dd><IssueStatusPill status={i.status} /></dd>
        <dt className="text-muted-foreground">{t('issues.field.severity')}</dt>
        <dd><SeverityLabel level={i.severity} /></dd>
        <dt className="text-muted-foreground">{t('issues.field.owner')}</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <PersonAvatar name={i.owner} className="size-5 text-[9px]" />
          <span className="truncate">{i.owner}</span>
          {i.affiliate && <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground">{i.affiliate}</span>}
        </dd>
        <dt className="text-muted-foreground">{t('issues.field.due')}</dt>
        <dd className={cn(overdue && 'font-medium text-risk-high')}>
          {formatDate(i.dueAt)}{overdue && ` · ${t('issues.due.overdue')}`}
        </dd>
        {i.affiliateManager && (
          <>
            <dt className="self-start text-muted-foreground">{t('issue.panel.manager')}</dt>
            <dd className="grid gap-0.5">
              <span className="flex items-center gap-1.5"><PersonAvatar name={i.affiliateManager} className="size-5 text-[9px]" />{i.affiliateManager}</span>
              {i.status !== 'resolved' && <span className="text-xs text-muted-foreground">{t('issue.panel.managerNote')}</span>}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('issues.field.source')}</dt>
        <dd>{sourceLabel}</dd>
        <dt className="text-muted-foreground">{t('issue.panel.opened')}</dt>
        <dd>{formatDate(i.openedAt)}</dd>
        {i.resolvedAt && (
          <>
            <dt className="text-muted-foreground">{t('issue.panel.resolved')}</dt>
            <dd>{formatDate(i.resolvedAt)}</dd>
          </>
        )}
      </dl>

      <section className="grid gap-2">
        <SectionHeading>{t('issue.panel.material')}</SectionHeading>
        {i.material ? <Link
          to="/materials/$materialId"
          params={{ materialId: i.material.id }}
          search={{ tab: 'live' }}
          className="grid gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/60"
        >
          <span className="flex items-start gap-2 font-medium">
            <ChannelIcon channel={i.channel} className="mt-0.5 size-4 shrink-0" />
            {i.material.title}
          </span>
          {material && (
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill status={material.status} />
              {material.liveStatus !== 'not_live' && <LiveStatusTag status={material.liveStatus} className="px-0" />}
            </span>
          )}
          {material?.approvalId && <code className="text-xs text-muted-foreground">{material.approvalId}</code>}
        </Link> : (
          <p className="flex items-start gap-2 rounded-lg border p-3 text-muted-foreground">
            <ChannelIcon channel={i.channel} className="mt-0.5 size-4 shrink-0" />
            {t('issue.panel.noMaterial')}
          </p>
        )}
      </section>

      {detail?.rule && (
        <section className="grid gap-2">
          <SectionHeading>{t('issue.panel.rule')}</SectionHeading>
          <Link to="/library/rules/$ruleId" params={{ ruleId: detail.rule.id }} className="group grid gap-0.5 text-sm">
            <code className="text-xs text-muted-foreground">{detail.rule.id}</code>
            <span className="group-hover:underline">{detail.rule.title}</span>
          </Link>
        </section>
      )}
    </aside>
  )
}
