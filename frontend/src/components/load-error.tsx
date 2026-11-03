import { Link } from '@tanstack/react-router'
import { CircleAlert, Lock, RotateCw, SearchX, WifiOff, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { loadErrorKind, type LoadErrorKind } from '@/lib/load-error'
import { cn } from '@/lib/utils'

const icons: Record<LoadErrorKind, LucideIcon> = { not_found: SearchX, forbidden: Lock, offline: WifiOff, server: CircleAlert }

/**
 * A failed load, by kind: the item does not exist, the role cannot open it, the connection is down, or the server failed.
 * `what` names the thing in the sentence, already translated ("material", "rules"). `back` is a link out, for not found.
 * Retry shows only where trying again can help (offline, server).
 */
export function LoadError({ error, what, onRetry, back, className }: {
  error: unknown
  what: string
  onRetry?: () => Promise<unknown> | void
  back?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const [retrying, setRetrying] = useState(false)
  const kind = loadErrorKind(error)
  const Icon = icons[kind]
  const canRetry = onRetry && (kind === 'offline' || kind === 'server')

  const retry = async () => {
    setRetrying(true)
    try {
      await onRetry?.()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div role="alert" className={cn('grid justify-items-start gap-2 py-6', className)}>
      <p className="flex items-center gap-2 font-medium">
        <Icon className={cn('size-4 shrink-0', kind === 'server' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
        {t(`loadError.${kind}`, { what })}
      </p>
      <p className="max-w-prose text-sm text-muted-foreground">{t(`loadError.${kind}Help`)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
        {canRetry && (
          <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}>
            <RotateCw className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden="true" />
            {t('loadError.retry')}
          </Button>
        )}
        {kind === 'not_found' && back}
        {kind === 'forbidden' && (
          <Link to="/dashboard" className="font-medium text-primary hover:underline">{t('loadError.toDashboard')}</Link>
        )}
      </div>
    </div>
  )
}

/** The quiet line above a list or a section when a refresh failed but the last data is still on screen. */
export function StaleNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-risk-medium-soft px-3 py-1.5 text-xs text-risk-medium">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      {t('loadError.stale')}
      <button type="button" onClick={onRetry} className="font-medium underline-offset-2 hover:underline">{t('loadError.retry')}</button>
    </p>
  )
}
