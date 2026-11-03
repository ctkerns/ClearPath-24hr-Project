import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { RegChangeStatus } from './reg-change-data'

// Same shape and outline as the issue and material status pills, so every list reads the same way.
const tone: Record<RegChangeStatus, string> = {
  waiting: 'bg-risk-medium-soft text-risk-medium',
  in_review: 'bg-info-soft text-info',
  applied: 'bg-risk-low-soft text-risk-low',
  dismissed: 'bg-background text-muted-foreground',
}

export function RegChangeStatusPill({ status, className }: { status: RegChangeStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="reg-change-status-pill"
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]',
        tone[status],
        className,
      )}
    >
      {t(`regChanges.status.${status}`)}
    </span>
  )
}
