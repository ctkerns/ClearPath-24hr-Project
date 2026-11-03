import { ChevronRight, CircleAlert, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, formatDateTime, formatRelativeTime } from '@/i18n/format'
import { cn } from '@/lib/utils'
import { providerInfo, useIntegrationUpdate, type Integration } from './integration-data'
import { ConnectDialog, DisconnectDialog } from './integration-dialogs'
import { IntegrationIcon, IntegrationStatusPill, PurposeList, VerifiedLabel } from './integration-meta'
import type { WorkspaceUser } from './user-data'

/** Column widths, shared by the header row and every row so they line up. */
const col = {
  name: 'min-w-0 flex-1',
  status: 'w-28 shrink-0',
  verified: 'w-24 shrink-0 max-md:hidden',
  accounts: 'w-24 shrink-0 max-lg:hidden',
  sync: 'w-28 shrink-0 max-sm:hidden',
  action: 'flex w-28 shrink-0 justify-end',
}

/** Column labels above the list. */
export function IntegrationListHeader() {
  const { t } = useTranslation()
  return (
    <div className="flex h-8 items-center gap-3 border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
      <span className={cn(col.name, 'pl-6')}>{t('settingsIntegrations.column.connector')}</span>
      <span className={col.status}>{t('settingsIntegrations.column.status')}</span>
      <span className={col.verified}>{t('settingsIntegrations.column.testing')}</span>
      <span className={col.accounts}>{t('settingsIntegrations.column.accounts')}</span>
      <span className={col.sync}>{t('settingsIntegrations.column.lastSync')}</span>
      <span className={col.action}><span className="sr-only">{t('settingsIntegrations.column.action')}</span></span>
    </div>
  )
}

/** One connector: a dense summary row that opens to its accounts, default owners and any error. */
export function IntegrationRow({ integration: i, owners, canEdit }: { integration: Integration; owners: WorkspaceUser[]; canEdit: boolean }) {
  const { t } = useTranslation()
  const { syncNow, setDefaultOwner } = useIntegrationUpdate()
  const [open, setOpen] = useState(i.status === 'error')
  const [dialog, setDialog] = useState<'connect' | 'disconnect' | null>(null)
  const info = providerInfo[i.provider]
  const p = `settingsIntegrations.provider.${i.provider}` as const
  const panelId = `integration-${i.id}`

  return (
    <li className="border-b">
      <div className="flex min-h-12 items-center gap-3 px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className={cn(col.name, 'flex items-center gap-2.5 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring')}
        >
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
          <IntegrationIcon provider={i.provider} />
          <span className="grid min-w-0">
            <span className="truncate font-medium">{t(`${p}.name`)}</span>
            {i.error ? (
              <span className="truncate text-xs text-risk-high">{t(`settingsIntegrations.error.${i.error.code}.short`)}</span>
            ) : (
              <span className="truncate text-xs text-muted-foreground">{t(`${p}.summary`)}</span>
            )}
          </span>
        </button>
        <span className={col.status}><IntegrationStatusPill status={i.status} /></span>
        <span className={col.verified}><VerifiedLabel verified={i.verified} /></span>
        <span className={cn(col.accounts, 'text-xs text-muted-foreground tabular-nums')}>
          {i.accounts.length ? t('settingsIntegrations.accountCount', { count: i.accounts.length }) : '—'}
        </span>
        <span className={cn(col.sync, 'text-xs text-muted-foreground')}>
          {i.lastSyncAt ? (
            <time dateTime={i.lastSyncAt} title={formatDateTime(i.lastSyncAt)}>{formatRelativeTime(i.lastSyncAt)}</time>
          ) : (
            t('settingsIntegrations.never')
          )}
        </span>
        <span className={col.action}>
          {canEdit && i.status === 'connected' && (
            <Button size="xs" variant="outline" onClick={() => syncNow(i.id)}>
              <RefreshCw aria-hidden="true" />
              {t('settingsIntegrations.syncNow')}
            </Button>
          )}
          {canEdit && i.status !== 'connected' && (
            <Button size="xs" variant="outline" onClick={() => setDialog('connect')}>
              {t(i.status === 'error' ? 'settingsIntegrations.reconnect' : 'settingsIntegrations.connectAction')}
            </Button>
          )}
        </span>
      </div>

      {open && (
        <div id={panelId} className="grid gap-4 border-t bg-muted/30 py-3 pr-3 pl-[3.25rem] text-sm">
          {i.error && (
            <div className="grid gap-1 rounded-md border border-risk-high/40 bg-background px-3 py-2">
              <p className="flex items-center gap-1.5 font-medium text-risk-high">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {t(`settingsIntegrations.error.${i.error.code}.message`, { date: formatDate(i.error.at) })}
              </p>
              <p>
                <span className="font-medium">{t('settingsIntegrations.error.fixLabel')}</span>{' '}
                {t(`settingsIntegrations.error.${i.error.code}.fix`)}
              </p>
            </div>
          )}

          <div className="grid gap-1">
            <PurposeList provider={i.provider} />
            <p className="flex gap-3">
              <span className="w-24 shrink-0 text-muted-foreground">{t('settingsIntegrations.testing')}</span>
              <span className="text-muted-foreground">{t(i.verified ? 'settingsIntegrations.verifiedHint' : 'settingsIntegrations.unverifiedHint')}</span>
            </p>
          </div>

          <section className="grid gap-1.5">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('settingsIntegrations.accounts.heading')}</h3>
            {i.accounts.length === 0 ? (
              <p className="text-muted-foreground">{t('settingsIntegrations.accounts.none')}</p>
            ) : (
              <ul className="grid divide-y rounded-md border bg-background">
                {i.accounts.map((a) => (
                  <li key={a.id} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{a.detail}</span>
                    </span>
                    {info.ownsContent && (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t('settingsIntegrations.accounts.defaultOwner')}</span>
                        <Select value={a.defaultOwnerId ?? ''} onValueChange={(v) => setDefaultOwner(i.id, a.id, v)} disabled={!canEdit}>
                          <SelectTrigger size="sm" className="w-44" aria-label={t('settingsIntegrations.accounts.defaultOwnerFor', { account: a.name })}>
                            <SelectValue placeholder={t('settingsIntegrations.accounts.noOwner')} />
                          </SelectTrigger>
                          <SelectContent>
                            {owners.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {info.ownsContent && i.accounts.length > 0 && (
              <p className="text-xs text-muted-foreground">{t('settingsIntegrations.accounts.defaultOwnerHelp')}</p>
            )}
          </section>

          {canEdit && i.status !== 'not_connected' && (
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={() => setDialog('connect')}>{t('settingsIntegrations.editAccounts')}</Button>
              <Button size="xs" variant="destructive-outline" onClick={() => setDialog('disconnect')}>{t('settingsIntegrations.disconnectAction')}</Button>
            </div>
          )}
        </div>
      )}

      <ConnectDialog integration={i} owners={owners} open={dialog === 'connect'} onClose={() => setDialog(null)} />
      <DisconnectDialog integration={i} open={dialog === 'disconnect'} onClose={() => setDialog(null)} />
    </li>
  )
}
