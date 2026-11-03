import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/** ClearPath Review logo: cobalt mark with a check, then the product name. */
export function AppLogo({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('flex items-center gap-2 font-semibold whitespace-nowrap', className)}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0">
        <rect x="1" y="1" width="18" height="18" rx="4" className="fill-primary" />
        <path
          d="M5.5 10.5l3 3 6-7"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-primary-foreground"
        />
      </svg>
      {t('app.name')}
      <span className="font-normal text-muted-foreground">{t('app.product')}</span>
    </span>
  )
}
