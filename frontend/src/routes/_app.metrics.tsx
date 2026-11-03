import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoadError } from '@/components/load-error'
import { useRules } from '@/components/library/rule-data'
import { CHANNELS, PRODUCTS, useMaterials, type Channel, type Product } from '@/components/materials/material-data'
import { ChannelIcon } from '@/components/materials/material-meta'
import { BarList, ChartSection, Sparkline, TrendChart } from '@/components/metrics/charts'
import {
  AGE_BUCKETS, bucketPastTarget, buckets, byBucket, PERIODS, queueNow, queueTarget, slice, summary, topRules, turnaroundByGroup,
  validateMetricsSearch, violationsByChannel, percentile, useMetricsData, type MetricsSearch, type Period,
} from '@/components/metrics/metrics-data'
import { useReviewerGroups } from '@/components/settings/group-data'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatNumber, formatPercent } from '@/i18n/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/metrics')({
  validateSearch: validateMetricsSearch,
  component: MetricsPage,
})

const ALL = 'all'

/**
 * Metrics (PRD F14): the throughput and quality metrics from PRD section 2, read like a monthly report.
 * One filter row scopes every number on the page. Each figure compares with the period just before.
 */
function MetricsPage() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const data = useMetricsData()
  const materials = useMaterials()
  const rules = useRules()
  const reviewerGroups = useReviewerGroups()
  const period = search.period ?? '90d'

  const set = (patch: Partial<MetricsSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  if (data.isPending || materials.isPending || reviewerGroups.isPending) return <MetricsSkeleton />
  // A failed materials or groups load must not show as an empty queue or an empty table.
  const failed = data.error ?? materials.error ?? reviewerGroups.error
  if (failed || !data.data) {
    return <LoadError error={failed} what={t('metrics.what')} onRetry={() => Promise.all([data.refetch(), materials.refetch(), reviewerGroups.refetch()])} />
  }
  if (data.data.decisions.length === 0 && data.data.violations.length === 0) {
    return (
      <div className="grid justify-items-start gap-2 py-6">
        <h1 className="sr-only">{t('page.metrics')}</h1>
        <p className="font-medium">{t('metrics.firstRun')}</p>
        <p className="max-w-prose text-sm text-muted-foreground">{t('metrics.firstRunHelp')}</p>
      </div>
    )
  }

  const s = slice(data.data, search)
  const now = summary(s.decisions)
  const before = summary(s.previous)
  const list = buckets(period, s.start, s.end)
  const perBucket = byBucket(s.decisions, (d) => d.decidedAt, list).map(summary)
  const bucketLabels = list.map((b) => formatDate(b.label, period === '12m' ? { month: 'short' } : { month: 'short', day: 'numeric' }))
  const queue = queueNow(materials.data ?? [], search)
  const groupList = reviewerGroups.data ?? []
  const groupNames = groupList.map((g) => g.name).sort((a, b) => a.localeCompare(b))
  const groups = turnaroundByGroup(s.decisions, groupNames)
  const target = queueTarget(groupList, search.group)
  const ruleRows = topRules(s.decisions)
  const ruleById = new Map((rules.data ?? []).map((r) => [r.id, r]))
  const channels = violationsByChannel(s.violations)
  const fixed = s.violations.flatMap((v) => (v.daysToFix === undefined ? [] : [v.daysToFix]))
  const fixedBefore = s.previousViolations.flatMap((v) => (v.daysToFix === undefined ? [] : [v.daysToFix]))
  const compared = t(`metrics.compared.${period}`)

  const days = (v: number) => t('metrics.days', { count: v, value: formatNumber(v, { maximumFractionDigits: 1 }) })
  const pct = (v: number) => formatPercent(v, 0)

  return (
    <div className="grid gap-8">
      <h1 className="sr-only">{t('page.metrics')}</h1>

      <Filters search={search} period={period} set={set} groupNames={groupNames} />

      <Part title={t('metrics.throughput')}>
        <FigureStrip>
          <Figure label={t('metrics.decisions')} value={formatNumber(now.count)} delta={<Delta now={now.count} before={before.count} better="up" format={(v) => formatNumber(v)} compared={compared} />} />
          <Figure
            label={t('metrics.medianTurnaround')}
            value={now.median === undefined ? '–' : days(now.median)}
            sub={now.p90 === undefined ? undefined : t('metrics.p90', { value: days(now.p90) })}
            delta={<Delta now={now.median} before={before.median} better="down" format={days} compared={compared} />}
          />
          <Figure label={t('metrics.firstPass')} value={now.firstPass === undefined ? '–' : pct(now.firstPass)} delta={<Delta now={now.firstPass} before={before.firstPass} better="up" format={(v) => t('metrics.points', { value: formatNumber(v * 100, { maximumFractionDigits: 0 }) })} compared={compared} />} />
          <Figure label={t('metrics.rounds')} value={now.rounds === undefined ? '–' : formatNumber(now.rounds, { maximumFractionDigits: 1 })} delta={<Delta now={now.rounds} before={before.rounds} better="down" format={(v) => formatNumber(v, { maximumFractionDigits: 1 })} compared={compared} />} />
        </FigureStrip>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <ChartSection
            title={t('metrics.turnaroundTrend')}
            note={t(period === '12m' ? 'metrics.byMonth' : 'metrics.byWeek')}
            chart={
              <TrendChart
                ariaLabel={t('metrics.turnaroundTrend')}
                labels={bucketLabels}
                format={(v) => formatNumber(v, { maximumFractionDigits: 1 })}
                series={[
                  { key: 'p90', label: t('metrics.p90Short'), color: 'var(--chart-2)', values: perBucket.map((b) => b.p90) },
                  { key: 'median', label: t('metrics.median'), color: 'var(--chart-1)', values: perBucket.map((b) => b.median) },
                ]}
              />
            }
            table={
              <DataTable
                head={[period === '12m' ? t('metrics.month') : t('metrics.weekOf'), t('metrics.decisions'), t('metrics.median'), t('metrics.p90Short')]}
                rows={perBucket.map((b, i) => [bucketLabels[i], formatNumber(b.count), b.median === undefined ? '–' : days(b.median), b.p90 === undefined ? '–' : days(b.p90)])}
              />
            }
          />
          <QueueNow queue={queue} search={search} target={target} />
        </div>

        <ChartSection
          title={t('metrics.byGroup')}
          note={t('metrics.byGroupNote')}
          chart={
            <DataTable
              head={[t('metrics.group'), t('metrics.decisions'), t('metrics.fullMedian'), t('metrics.fullP90'), t('metrics.shortMedian'), t('metrics.shortP90')]}
              rows={groups.map((g) => [
                g.group,
                formatNumber(g.count),
                ...[g.full.median, g.full.p90, g.short.median, g.short.p90].map((v) => (v === undefined ? '–' : days(v))),
              ])}
            />
          }
        />

        <ChartSection
          title={t('metrics.topIssues')}
          note={t('metrics.topIssuesNote')}
          chart={ruleRows.length ? (
            <BarList
              labelHeading={t('metrics.rule')}
              valueHeading={t('metrics.findings')}
              extraHeading={t('metrics.perHundred')}
              rows={ruleRows.map((r) => {
                const rule = ruleById.get(r.ruleId)
                return {
                  key: r.ruleId,
                  value: r.count,
                  valueText: formatNumber(r.count),
                  extra: formatNumber((r.count / Math.max(now.count, 1)) * 100, { maximumFractionDigits: 0 }),
                  label: (
                    <Link to="/library/rules/$ruleId" params={{ ruleId: r.ruleId }} className="group grid min-w-0">
                      <span className="truncate group-hover:underline">{rule?.title ?? r.ruleId}</span>
                      <span className="truncate text-xs text-muted-foreground">{rule?.citation?.label ?? t('rules.kind.policy')}</span>
                    </Link>
                  ),
                }
              })}
            />
          ) : <Empty />}
        />
      </Part>

      <Part title={t('metrics.monitoring')} note={search.group ? t('metrics.noGroupFilter') : undefined}>
        <FigureStrip>
          <Figure label={t('metrics.violationsFound')} value={formatNumber(s.violations.length)} delta={<Delta now={s.violations.length} before={s.previousViolations.length} better="down" format={(v) => formatNumber(v)} compared={compared} />} />
          <Figure label={t('metrics.stillOpen')} value={formatNumber(s.violations.length - fixed.length)} />
          <Figure
            label={t('metrics.timeToFix')}
            value={fixed.length ? days(percentile(fixed, 0.5) as number) : '–'}
            delta={<Delta now={percentile(fixed, 0.5)} before={percentile(fixedBefore, 0.5)} better="down" format={days} compared={compared} />}
          />
        </FigureStrip>
        <ChartSection
          title={t('metrics.byChannel')}
          aside={<Link to="/issues" search={{ source: 'monitoring' }} className="text-xs font-medium text-primary hover:underline">{t('metrics.openIssues')}</Link>}
          chart={channels.length ? (
            <BarList
              labelHeading={t('metrics.channel')}
              valueHeading={t('metrics.found')}
              extraHeading={t('metrics.medianFix')}
              rows={channels.map((c) => ({
                key: c.channel,
                value: c.count,
                valueText: c.open ? t('metrics.foundOpen', { count: c.count, open: c.open }) : formatNumber(c.count),
                extra: c.medianFix === undefined ? '–' : days(c.medianFix),
                label: <span className="flex items-center gap-2"><ChannelIcon channel={c.channel} className="size-3.5 shrink-0" />{t(`materials.channel.${c.channel}`)}</span>,
              }))}
            />
          ) : <Empty />}
        />
      </Part>

      <Part title={t('metrics.quality')}>
        <div className="grid overflow-hidden rounded-lg border md:grid-cols-3">
          <QualityFigure
            label={t('metrics.postApproval')}
            definition={t('metrics.postApprovalDef')}
            value={now.postApprovalViolation}
            before={before.postApprovalViolation}
            trend={perBucket.map((b) => b.postApprovalViolation)}
            better="down"
            compared={compared}
          />
          <QualityFigure
            label={t('metrics.aiFix')}
            definition={t('metrics.aiFixDef')}
            value={now.aiFixRate}
            before={before.aiFixRate}
            trend={perBucket.map((b) => b.aiFixRate)}
            better="up"
            compared={compared}
          />
          <QualityFigure
            label={t('metrics.aiMiss')}
            definition={t('metrics.aiMissDef')}
            value={now.aiMissRate}
            before={before.aiMissRate}
            trend={perBucket.map((b) => b.aiMissRate)}
            better="down"
            compared={compared}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('metrics.evalNote')}</p>
      </Part>
    </div>
  )
}

/** One row of filters above everything. All of them live in the URL, so a filtered report can be shared. */
function Filters({ search, period, set, groupNames }: { search: MetricsSearch; period: Period; set: (patch: Partial<MetricsSearch>) => void; groupNames: string[] }) {
  const { t } = useTranslation()
  const filtered = search.channel || search.product || search.group
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t('metrics.period')} className="flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            onClick={() => set({ period: p === '90d' ? undefined : p })}
            className={cn(
              'h-7 rounded-md border border-transparent px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              'aria-pressed:border-border aria-pressed:bg-muted aria-pressed:text-foreground',
            )}
          >
            {t(`metrics.periods.${p}`)}
          </button>
        ))}
      </div>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      <FilterSelect
        label={t('metrics.channel')}
        value={search.channel}
        all={t('metrics.allChannels')}
        options={CHANNELS.map((c) => [c, t(`materials.channel.${c}`)])}
        onChange={(v) => set({ channel: v as Channel | undefined })}
      />
      <FilterSelect
        label={t('metrics.product')}
        value={search.product}
        all={t('metrics.allProducts')}
        options={PRODUCTS.map((p) => [p, t(`materials.product.${p}`)])}
        onChange={(v) => set({ product: v as Product | undefined })}
      />
      <FilterSelect
        label={t('metrics.group')}
        value={search.group}
        all={t('metrics.allGroups')}
        options={groupNames.map((g) => [g, g])}
        onChange={(v) => set({ group: v })}
      />
      {filtered && (
        <button type="button" onClick={() => set({ channel: undefined, product: undefined, group: undefined })} className="h-7 px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          {t('list.clearAll')}
        </button>
      )}
    </div>
  )
}

function FilterSelect({ label, value, all, options, onChange }: {
  label: string
  value?: string
  all: string
  options: [string, string][]
  onChange: (value: string | undefined) => void
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger size="sm" aria-label={label} className={cn('h-7 text-xs', value && 'border-primary/40 bg-primary-soft text-primary-strong')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map(([v, text]) => <SelectItem key={v} value={v}>{text}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** A part of the report, like a chapter: a small heading and a rule line above it. */
function Part({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 border-t pt-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  )
}

/** Headline figures side by side in one box, divided by hairlines, like the summary row of a report. */
function FigureStrip({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] [&>div]:-mt-px [&>div]:-ml-px [&>div]:border-t [&>div]:border-l">{children}</dl>
}

function Figure({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold">{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </dd>
      {delta && <dd className="text-xs">{delta}</dd>}
    </div>
  )
}

/**
 * The change from the previous period. Green means better and red means worse, with an arrow and words too,
 * so the meaning never depends on the color.
 */
function Delta({ now, before, better, format, compared }: {
  now?: number
  before?: number
  better: 'up' | 'down'
  format: (v: number) => string
  compared: string
}) {
  const { t } = useTranslation()
  if (now === undefined || before === undefined) return <span className="text-muted-foreground">{t('metrics.noCompare')}</span>
  const diff = now - before
  const same = Math.abs(diff) < (Math.abs(before) || 1) * 0.02
  const good = !same && (diff < 0) === (better === 'down')
  const Icon = same ? Minus : diff > 0 ? ArrowUp : ArrowDown
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className={cn('inline-flex items-center gap-0.5 font-medium', same ? 'text-foreground' : good ? 'text-risk-low' : 'text-risk-high')}>
        <Icon className="size-3" aria-hidden="true" />
        {same ? t('metrics.same') : format(Math.abs(diff))}
        <span className="sr-only">{same ? '' : good ? t('metrics.better') : t('metrics.worse')}</span>
      </span>
      {compared}
    </span>
  )
}

function QualityFigure({ label, definition, value, before, trend, better, compared }: {
  label: string
  definition: string
  value?: number
  before?: number
  trend: (number | undefined)[]
  better: 'up' | 'down'
  compared: string
}) {
  const { t } = useTranslation()
  return (
    <div className="-mt-px -ml-px grid content-start gap-2 border-t border-l px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value === undefined ? '–' : formatPercent(value, 1)}</p>
        </div>
        <Sparkline values={trend} className="mt-1" />
      </div>
      <p className="text-xs">
        <Delta now={value} before={before} better={better} format={(v) => t('metrics.points', { value: formatNumber(v * 100, { maximumFractionDigits: 1 }) })} compared={compared} />
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{definition}</p>
    </div>
  )
}

/** The open queue now, by status and business days waiting. Each total opens the filtered Materials list. */
function QueueNow({ queue, search, target }: { queue: ReturnType<typeof queueNow>; search: MetricsSearch; target: ReturnType<typeof queueTarget> }) {
  const { t } = useTranslation()
  const listSearch = { channel: search.channel, product: search.product, group: search.group }
  return (
    <section className="grid content-start gap-3">
      <div className="grid gap-0.5">
        <h2 className="text-sm font-semibold">{t('metrics.queueNow')}</h2>
        <p className="text-xs text-muted-foreground">{t('metrics.queueNote', { count: queue.total, oldest: queue.oldest })}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-2 text-left font-medium">{t('metrics.status')}</th>
            {AGE_BUCKETS.map((b) => <th key={b} className="px-1.5 py-1.5 text-right font-medium">{t(`metrics.age.${b}`)}</th>)}
            <th className="py-1.5 pl-2 text-right font-medium">{t('metrics.total')}</th>
          </tr>
        </thead>
        <tbody>
          {queue.rows.map((r) => (
            <tr key={r.status} className="border-b">
              <td className="py-2 pr-2">{t(`status.${r.status}`)}</td>
              {r.cells.map((n, i) => (
                // A bucket whose items have all waited past the review target (from Settings) shows its count in bold.
                <td key={i} className={cn('px-1.5 py-2 text-right tabular-nums', n === 0 ? 'text-muted-foreground/60' : target && bucketPastTarget(i, target.days) && 'font-semibold')}>{n || '·'}</td>
              ))}
              <td className="py-2 pl-2 text-right tabular-nums">
                {r.total ? <Link to="/materials" search={{ ...listSearch, status: r.status }} className="font-medium text-primary hover:underline">{r.total}</Link> : <span className="text-muted-foreground/60">·</span>}
              </td>
            </tr>
          ))}
          <tr className="text-xs text-muted-foreground">
            <td className="py-2 pr-2">{t('metrics.total')}</td>
            {queue.totals.map((n, i) => <td key={i} className="px-1.5 py-2 text-right tabular-nums">{n}</td>)}
            <td className="py-2 pl-2 text-right font-medium text-foreground tabular-nums">{queue.total}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        {t('metrics.queueAge')}
        {target && <> {t('metrics.queueTarget', { group: target.name, count: target.days })}</>}
      </p>
    </section>
  )
}

function DataTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            {head.map((h, i) => <th key={h} className={cn('py-1.5 font-medium whitespace-nowrap', i === 0 ? 'pr-3 text-left' : 'pl-3 text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b last:border-b-0">
              {row.map((cell, i) => <td key={i} className={cn('py-2 whitespace-nowrap', i === 0 ? 'pr-3' : 'pl-3 text-right tabular-nums')}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Empty() {
  const { t } = useTranslation()
  return <p className="py-6 text-center text-xs text-muted-foreground">{t('metrics.empty')}</p>
}

function MetricsSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-7 w-96 max-w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-60 w-full" />
    </div>
  )
}
