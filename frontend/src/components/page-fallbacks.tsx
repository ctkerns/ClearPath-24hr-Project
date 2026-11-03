import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * A page that crashed while it rendered (a bug, not a failed request). It shows inside the app shell,
 * so the person can still go elsewhere. The error goes to the console for the bug report.
 */
export function PageCrash({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation()
  useEffect(() => console.error(error), [error])
  return (
    <div role="alert" className="mx-auto grid w-full max-w-7xl justify-items-start gap-2 py-10">
      <p className="font-medium">{t('pageFallback.crash')}</p>
      <p className="max-w-prose text-sm text-muted-foreground">{t('pageFallback.crashHelp')}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        <Button variant="outline" size="sm" onClick={() => { reset(); window.location.reload() }}>{t('pageFallback.reload')}</Button>
        <Link to="/dashboard" className="font-medium text-primary hover:underline">{t('loadError.toDashboard')}</Link>
      </div>
    </div>
  )
}

/** A URL that matches no page. */
export function PageNotFound() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid w-full max-w-7xl justify-items-start gap-2 px-4 py-10">
      <h1 className="font-medium">{t('pageFallback.notFound')}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{t('pageFallback.notFoundHelp')}</p>
      <Link to="/dashboard" className="mt-1 text-sm font-medium text-primary hover:underline">{t('loadError.toDashboard')}</Link>
    </div>
  )
}
