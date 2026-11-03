import { useTranslation } from 'react-i18next'
import type { Deadline } from '@/components/dashboard/dashboard-data'
import { formatDate } from '@/i18n/format'
import { cn } from '@/lib/utils'

/** How long a review has left before the group deadline. Late is red; today and tomorrow are amber. */
export function DeadlineLabel({ deadline: d, className }: { deadline: Deadline; className?: string }) {
  const { t } = useTranslation()
  const tone = d.overdue ? 'font-medium text-risk-high' : d.daysLeft <= 1 ? 'font-medium text-risk-medium' : 'text-muted-foreground'
  const text =
    d.daysLeft < 0 ? t('dashboard.deadline.late', { count: -d.daysLeft })
      : d.daysLeft === 0 ? t('dashboard.deadline.today')
        : d.daysLeft === 1 ? t('dashboard.deadline.tomorrow')
          : t('dashboard.deadline.on', { date: formatDate(d.at, { month: 'short', day: 'numeric' }) })
  return <span title={t('dashboard.deadline.title', { date: formatDate(d.at), count: d.targetDays })} className={cn(tone, className)}>{text}</span>
}
