import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LevelShape } from '@/components/ui/risk-tag'
import type { IssueStatus } from './issue-data'

// Same shape and outline as the material StatusPill, so both lists read the same way.
const tone: Record<IssueStatus, string> = {
  open: 'bg-background text-risk-high',
  in_progress: 'bg-info-soft text-info',
  resolved: 'bg-risk-low-soft text-risk-low',
}

export function IssueStatusPill({ status, className }: { status: IssueStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="issue-status-pill"
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]',
        tone[status],
        className,
      )}
    >
      {t(`issues.status.${status}`)}
    </span>
  )
}

/** Icon for the Severity filter: the triangle, the same mark as a High finding. */
export function SeverityFieldIcon({ className }: { className?: string }) {
  return <LevelShape level="high" className={className} />
}
