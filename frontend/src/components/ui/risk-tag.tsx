import { cn } from "cn"
import { useTranslation } from "react-i18next"

/** Finding severity (PRD F7): one three-level scale for findings and rules. */
export type RiskLevel = "low" | "medium" | "high"

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

const severityColor: Record<RiskLevel, string> = {
  high: "text-risk-high",
  medium: "text-risk-medium",
  low: "text-risk-low",
}

/** Plain text label for a finding's severity, with its shape. */
function SeverityLabel({ level, className }: { level: RiskLevel; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="severity-label"
      className={cn("inline-flex items-center gap-1 text-xs font-semibold", severityColor[level], className)}
    >
      <LevelShape level={level} className="size-2" />
      {t(`level.${level}`)}
    </span>
  )
}

export { SeverityLabel, LevelShape }
