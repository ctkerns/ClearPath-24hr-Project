import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

/**
 * The body of a page that the viewer's role cannot open, for example the library for an affiliate (PRD R4).
 * The nav hides these pages; this is for a link or a typed URL. The page does not call its API at all.
 */
export function NotAvailable({ page }: { page: string }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid w-full max-w-7xl justify-items-start gap-2 rounded-lg border border-dashed p-6">
      <h1 className="font-medium">{t('notAvailable.title', { page })}</h1>
      <p className="text-sm text-muted-foreground">{t('notAvailable.body')}</p>
      <Link to="/dashboard" className="text-sm text-primary hover:underline">{t('notAvailable.back')}</Link>
    </div>
  )
}
