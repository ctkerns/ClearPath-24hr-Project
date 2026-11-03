import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "cn"

/** Risk tier (PRD F6) and finding severity share one three-level scale. */
export type RiskLevel = "low" | "medium" | "high"

const levelLabels: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" }

/** Each level also has its own shape, so the tag reads without color. */
function LevelShape({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className={cn("size-2.5 shrink-0", className)}>
      {level === "high" && <path d="M5 0.8 9.6 9.2H0.4Z" fill="currentColor" />}
      {level === "medium" && <path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" fill="currentColor" />}
      {level === "low" && <circle cx="5" cy="5" r="4" fill="currentColor" />}
    </svg>
  )
}

const riskTagVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border border-current px-1.5 py-px text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      level: {
        high: "text-risk-high",
        medium: "text-risk-medium",
        low: "text-risk-low",
      },
    },
  }
)

/** Outlined tag for a material's risk tier. Default text: "High risk". */
function RiskTag({
  level,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { level: RiskLevel }) {
  return (
    <span data-slot="risk-tag" data-level={level} className={cn(riskTagVariants({ level }), className)} {...props}>
      <LevelShape level={level} />
      {children ?? `${levelLabels[level]} risk`}
    </span>
  )
}

const severityColor: Record<RiskLevel, string> = {
  high: "text-risk-high",
  medium: "text-risk-medium",
  low: "text-risk-low",
}

/** Plain text label for a finding's severity, with its shape. */
function SeverityLabel({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span
      data-slot="severity-label"
      className={cn("inline-flex items-center gap-1 text-xs font-semibold", severityColor[level], className)}
    >
      <LevelShape level={level} className="size-2" />
      {levelLabels[level]}
    </span>
  )
}

export { RiskTag, SeverityLabel, LevelShape, riskTagVariants, levelLabels }
