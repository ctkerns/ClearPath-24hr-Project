import * as React from "react"
import { cn } from "cn"
import type { RiskLevel } from "@/components/ui/risk-tag"

const markColor: Record<RiskLevel, string> = {
  high: "bg-risk-high-soft shadow-[inset_0_-2px_0_var(--color-risk-high)]",
  medium: "bg-risk-medium-soft shadow-[inset_0_-2px_0_var(--color-risk-medium)]",
  low: "bg-risk-low-soft shadow-[inset_0_-2px_0_var(--color-risk-low)]",
}

/** Marks text in reviewed content that a finding points to. `number` links it to the finding card. */
function FlaggedText({
  severity,
  number,
  active = false,
  className,
  children,
  ...props
}: React.ComponentProps<"mark"> & { severity: RiskLevel; number?: number; active?: boolean }) {
  return (
    <mark
      data-slot="flagged-text"
      data-severity={severity}
      className={cn(
        "rounded-[2px] px-0.5 text-inherit",
        markColor[severity],
        active && "outline-2 outline-offset-1 outline-primary",
        className
      )}
      {...props}
    >
      {children}
      {number !== undefined && (
        <sup className="ml-0.5 font-mono text-[9px] font-semibold text-foreground">{number}</sup>
      )}
    </mark>
  )
}

export { FlaggedText }
