import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/** The server's message after a failed save, above the dialog buttons. Screen readers announce it. */
export function SaveError({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-risk-high-soft px-3 py-2 text-xs text-destructive">
      {error}
    </p>
  )
}

/** The one-line message beside a control that saves at once, after the save failed. Screen readers announce it. */
export function InlineSaveError({ error, className }: { error?: string; className?: string }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {t('app.notSaved', { message: error })}
    </p>
  )
}
