import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "cn"
import { useTranslation } from "react-i18next"

/** Material statuses from PRD section 6. */
export type MaterialStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "rejected"
  | "approved"
  | "live"
  | "expired"
  | "retired"

const statusPillVariants = cva(
  "inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]",
  {
    variants: {
      status: {
        draft: "bg-neutral-soft text-neutral",
        submitted: "bg-background text-info",
        in_review: "bg-info-soft text-info",
        changes_requested: "bg-risk-medium-soft text-risk-medium",
        rejected: "bg-risk-high-soft text-risk-high",
        approved: "bg-risk-low-soft text-risk-low",
        live: "bg-risk-low text-white shadow-[inset_0_0_0_1px_var(--color-risk-low)]",
        expired: "bg-background text-neutral",
        retired: "bg-background text-muted-foreground line-through",
      },
    },
  }
)

function StatusPill({
  status,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { status: MaterialStatus }) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(statusPillVariants({ status }), className)}
      {...props}
    >
      {children ?? t(`status.${status}`)}
    </span>
  )
}

export { StatusPill, statusPillVariants }
