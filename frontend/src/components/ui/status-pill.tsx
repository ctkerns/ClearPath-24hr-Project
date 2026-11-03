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
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap before:size-1.5 before:shrink-0 before:rounded-full before:content-['']",
  {
    variants: {
      status: {
        draft: "bg-neutral-soft text-neutral before:bg-current",
        submitted: "text-info shadow-[inset_0_0_0_1px_var(--color-info)] before:border before:border-current",
        in_review: "bg-info-soft text-info before:bg-current",
        changes_requested: "bg-risk-medium-soft text-risk-medium before:bg-current",
        rejected: "bg-risk-high-soft text-risk-high before:bg-current",
        approved: "bg-risk-low-soft text-risk-low before:bg-current",
        live: "bg-risk-low text-white before:bg-white",
        expired: "text-neutral shadow-[inset_0_0_0_1px_var(--color-border)] before:bg-current",
        retired: "text-muted-foreground line-through before:border before:border-current",
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
