import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/** The ClearPath mark alone: cobalt square with a check, tilted 15° clockwise like an approval stamp. */
export function AppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cn('size-5 shrink-0 rotate-[15deg]', className)}>
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
  )
}

/** Full logo: mark plus "ClearPath Review". For pages without the app bar, such as sign-in. */
export function AppLogo({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('flex items-center font-semibold whitespace-nowrap', className)}>
      <AppMark className="mr-1" />
      {t('app.name')}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-input" />
      <span className="font-normal text-muted-foreground">{t('app.product')}</span>
    </span>
  )
}
