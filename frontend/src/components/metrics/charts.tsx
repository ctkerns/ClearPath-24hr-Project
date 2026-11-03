import { useState } from 'react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useElementWidth } from './use-element-width'

// Hand-drawn SVG and HTML charts for Metrics. Specs: 2px lines, >= 8px dots with a 2px surface ring,
// hairline solid grid, thin bars with a 4px rounded end, text in text colors and never in the series color.
// Series colors are --chart-1 (cobalt) and --chart-2 (teal), checked for color-vision separation.

export type Series = { key: string; label: string; color: string; values: (number | undefined)[] }

/** Round tick steps (1, 2 or 5 times a power of ten) from zero to above the largest value. */
function ticks(max: number, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000)
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step)
  return out
}

const PLOT_HEIGHT = 180
const AXIS_BAND = 24
const MARGIN = { top: 10, left: 36, right: 92 }

/**
 * Lines over time on one axis, with a crosshair and a tooltip on hover or arrow keys.
 * Each line ends in a dot and its name and last value, and a legend sits above, so identity never needs the color.
 */
export function TrendChart({ series, labels, format, ariaLabel }: {
  series: Series[]
  labels: string[]
  format: (value: number) => string
  ariaLabel: string
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number>()
  const n = labels.length
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== undefined)))
  const yTicks = ticks(max)
  const top = yTicks[yTicks.length - 1]
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const x = (i: number) => MARGIN.left + (n <= 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth)
  const y = (v: number) => MARGIN.top + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT
  // Show every label when they fit, or every second or third one when they do not.
  const every = Math.max(1, Math.ceil((n * 52) / Math.max(plotWidth, 1)))

  const path = (values: (number | undefined)[]) =>
    values.reduce((d, v, i) => (v === undefined ? d : `${d}${i === 0 || values[i - 1] === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '')

  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left - MARGIN.left) / Math.max(plotWidth, 1)
    setActive(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))))
  }

  // End labels sit at each line's last value. When two are close, the lower one moves down so they do not overlap.
  const ends = series
    .map((s) => {
      const last = s.values.findLastIndex((v) => v !== undefined)
      return last < 0 ? undefined : { s, i: last, y: y(s.values[last] as number) }
    })
    .filter((e) => e !== undefined)
    .sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 26)

  return (
    <div className="grid gap-2">
      {series.length > 1 && <Legend items={series} />}
      <div ref={ref} className="relative" style={{ height: PLOT_HEIGHT + MARGIN.top + AXIS_BAND }}>
        {width > 0 && (
          <svg
            width={width}
            height={PLOT_HEIGHT + MARGIN.top + AXIS_BAND}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            className="overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setActive(undefined)}
            onBlur={() => setActive(undefined)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1))
              else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1))
              else return
              e.preventDefault()
            }}
          >
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{format(v)}</text>
              </g>
            ))}
            {labels.map((label, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every) && (
              <text key={i} x={x(i)} y={MARGIN.top + PLOT_HEIGHT + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">{label}</text>
            ))}
            {active !== undefined && (
              <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--muted-foreground)" strokeWidth={1} shapeRendering="crispEdges" />
            )}
            {series.map((s) => (
              <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {ends.map(({ s, i, y: labelY }) => (
              <g key={s.key}>
                <circle cx={x(i)} cy={y(s.values[i] as number)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                <text x={x(i) + 10} y={labelY} dy="-0.15em" className="fill-foreground text-xs font-medium tabular-nums">{format(s.values[i] as number)}</text>
                <text x={x(i) + 10} y={labelY} dy="1.05em" className="fill-muted-foreground text-[11px]">{s.label}</text>
              </g>
            ))}
            {active !== undefined && series.map((s) => s.values[active] !== undefined && (
              <circle key={s.key} cx={x(active)} cy={y(s.values[active] as number)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
            ))}
          </svg>
        )}
        {active !== undefined && width > 0 && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 grid min-w-32 gap-1 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md"
            style={x(active) > width / 2 ? { right: width - x(active) + 10 } : { left: x(active) + 10 }}
          >
            <span className="font-medium">{labels[active]}</span>
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-2">
                <Swatch color={s.color} line />
                <span className="flex-1 text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{s.values[active] === undefined ? '–' : format(s.values[active] as number)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** A short line or a square in the series color, beside text that names it. */
function Swatch({ color, line }: { color: string; line?: boolean }) {
  return <span aria-hidden="true" className={cn('shrink-0', line ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-[2px]')} style={{ background: color }} />
}

export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5"><Swatch color={s.color} line />{s.label}</li>
      ))}
    </ul>
  )
}

export type BarRow = { key: string; label: React.ReactNode; value: number; valueText: string; extra?: React.ReactNode }

/**
 * Ranked horizontal bars in one color, largest first. The value prints at each bar's end, so no tooltip is needed.
 * `extra` is an optional last column, for example the median days to fix.
 */
export function BarList({ rows, extraHeading, labelHeading, valueHeading }: {
  rows: BarRow[]
  labelHeading: string
  valueHeading: string
  extraHeading?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="w-[45%] py-1.5 pr-3 font-medium">{labelHeading}</th>
          <th className="py-1.5 font-medium">{valueHeading}</th>
          {extraHeading && <th className="w-24 py-1.5 pl-3 text-right font-medium">{extraHeading}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b last:border-b-0">
            <td className="py-2 pr-3 align-middle">{r.label}</td>
            <td className="py-2 align-middle">
              <span className="flex items-center gap-2">
                <span className="h-2.5 min-w-0.5 rounded-r-[4px] bg-chart-1" style={{ width: `${(r.value / max) * 80}%` }} aria-hidden="true" />
                <span className="text-xs font-medium tabular-nums">{r.valueText}</span>
              </span>
            </td>
            {extraHeading && <td className="py-2 pl-3 text-right text-xs text-muted-foreground tabular-nums">{r.extra}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A small trend line in gray with the last point in cobalt. It shows the shape only; the figure beside it carries the value. */
export function Sparkline({ values, className }: { values: (number | undefined)[]; className?: string }) {
  const known = values.filter((v): v is number => v !== undefined)
  if (known.length < 2) return null
  const w = 96, h = 28, pad = 4
  const max = Math.max(...known), min = Math.min(...known)
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - 2 * pad)
  const y = (v: number) => pad + (max === min ? (h - 2 * pad) / 2 : (1 - (v - min) / (max - min)) * (h - 2 * pad))
  const d = values.reduce((acc, v, i) => (v === undefined ? acc : `${acc}${acc && values[i - 1] !== undefined ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '')
  const last = values.findLastIndex((v) => v !== undefined)
  return (
    <svg width={w} height={h} aria-hidden="true" className={cn('overflow-visible', className)}>
      <path d={d} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last] as number)} r={3.5} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />
    </svg>
  )
}

/** A titled chart with a Chart / Table switch, so every value can also be read as text. */
export function ChartSection({ title, note, chart, table, aside }: {
  title: string
  note?: string
  chart: React.ReactNode
  table?: React.ReactNode
  aside?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <section className="grid content-start gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        <div className="flex items-center gap-2">
          {aside}
          {table && (
            <div role="group" aria-label={t('metrics.view')} className="flex rounded-md border p-0.5">
              {(['chart', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className="h-6 rounded-[3px] px-2 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {t(`metrics.${v}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {view === 'chart' || !table ? chart : table}
    </section>
  )
}
