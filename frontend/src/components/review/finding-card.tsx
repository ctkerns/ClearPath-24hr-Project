import * as React from "react"
import { cn } from "cn"
import { useTranslation } from "react-i18next"
import { SeverityLabel, type RiskLevel } from "@/components/ui/risk-tag"

/** Finding statuses from the data model (PRD section 9). */
export type FindingStatus = "open" | "outdated" | "hidden"

const ruleColor: Record<RiskLevel, string> = {
  high: "border-l-risk-high",
  medium: "border-l-risk-medium",
  low: "border-l-risk-low",
}

type FindingCardProps = Omit<React.ComponentProps<"article">, "children"> & {
  number?: number
  severity: RiskLevel
  ruleId: string
  /** "ai" shows the "AI suggestion" label (PRD F4). */
  source: "ai" | "human"
  author?: string
  flaggedText: string
  explanation: React.ReactNode
  suggestion?: React.ReactNode
  status?: FindingStatus
  actions?: React.ReactNode
}

/** One finding from the AI reviewer or a person, linked to a rule and to flagged text. */
function FindingCard({
  number,
  severity,
  ruleId,
  source,
  author,
  flaggedText,
  explanation,
  suggestion,
  status = "open",
  actions,
  className,
  ...props
}: FindingCardProps) {
  const { t } = useTranslation()
  const outdated = status === "outdated"
  return (
    <article
      data-slot="finding-card"
      data-status={status}
      className={cn(
        "grid gap-1.5 rounded-lg border border-l-[3px] bg-card p-2.5",
        outdated ? "border-l-border" : ruleColor[severity],
        className
      )}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-2">
        {number !== undefined && (
          <span className="grid size-[18px] place-items-center rounded-full bg-foreground font-mono text-[10.5px] font-semibold text-background">
            {number}
          </span>
        )}
        <SeverityLabel level={severity} className={cn(outdated && "text-muted-foreground")} />
        <code className="text-xs text-muted-foreground">{ruleId}</code>
        <span className="ml-auto flex items-center gap-1.5">
          {outdated && (
            <span className="rounded-sm bg-neutral-soft px-1.5 text-xs font-semibold text-neutral">{t("finding.outdated")}</span>
          )}
          {source === "ai" ? (
            <span className="rounded-sm border border-dashed px-1.5 text-[10.5px] whitespace-nowrap text-muted-foreground">
              {t("finding.aiSuggestion")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{author}</span>
          )}
        </span>
      </div>
      <p className={cn("text-sm", outdated && "text-muted-foreground")}>
        <q className="font-semibold">{flaggedText}</q> {explanation}
      </p>
      {suggestion && !outdated && (
        <p className="flex items-baseline gap-1.5 text-sm text-primary-strong">
          <b className="font-semibold whitespace-nowrap">{t("finding.fix")}</b>
          <span>{suggestion}</span>
        </p>
      )}
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </article>
  )
}

export { FindingCard }
