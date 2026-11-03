import { ExternalLink, Info } from 'lucide-react'
import { useState } from 'react'
import { SaveError } from '@/components/save-error'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSave } from '@/lib/use-save'
import { useWorkspace } from '@/lib/workspace'
import { providerInfo, useIntegrationUpdate, type Integration } from './integration-data'
import { PurposeList } from './integration-meta'
import type { WorkspaceUser } from './user-data'

/**
 * Connect or reconnect a connector (PRD F11). Two steps, like a real OAuth flow:
 * 1. Say what access ClearPath asks for, then hand off to the platform's own sign-in page.
 * 2. Back from the platform: pick the accounts and their default owner.
 * The tool never asks for a password or key here. In the demo no sign-in page opens; step 2 lists seeded accounts.
 */
export function ConnectDialog({ integration, owners, open, onClose }: {
  integration: Integration
  owners: WorkspaceUser[]
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so each time starts at step 1. */}
        {open && <ConnectFlow integration={integration} owners={owners} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ConnectFlow({ integration: i, owners, onClose }: { integration: Integration; owners: WorkspaceUser[]; onClose: () => void }) {
  const { t } = useTranslation()
  const { isDemo } = useWorkspace()
  const { connect } = useIntegrationUpdate()
  const save = useSave(onClose)
  const info = providerInfo[i.provider]
  const name = t(`settingsIntegrations.provider.${i.provider}.name`)
  const [step, setStep] = useState<'access' | 'accounts'>(info.needsAuth ? 'access' : 'accounts')
  const [picked, setPicked] = useState<string[]>(() =>
    i.accounts.length ? i.accounts.map((a) => a.name) : i.available.map((a) => a.name),
  )
  const [ownerId, setOwnerId] = useState(() => i.accounts[0]?.defaultOwnerId ?? owners[0]?.id ?? '')
  const reconnect = i.status !== 'not_connected'
  const ready = picked.length > 0 && (!info.ownsContent || ownerId)

  if (step === 'access') {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{t(reconnect ? 'settingsIntegrations.connect.reconnectTitle' : 'settingsIntegrations.connect.title', { name })}</DialogTitle>
          <DialogDescription>{t('settingsIntegrations.connect.accessIntro', { name })}</DialogDescription>
        </DialogHeader>
        <PurposeList provider={i.provider} />
        <p className="text-xs text-muted-foreground">{t('settingsIntegrations.connect.noSecrets', { name })}</p>
        {isDemo && <DemoNote text={t('settingsIntegrations.connect.demoNote', { name })} />}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('settingsIntegrations.cancel')}</Button>
          <Button type="button" onClick={() => setStep('accounts')}>
            {t('settingsIntegrations.connect.continue', { name })}
            <ExternalLink aria-hidden="true" />
          </Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || save.pending) return
        void save.run(() => connect(i.id, picked, info.ownsContent ? ownerId : undefined))
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('settingsIntegrations.connect.accountsTitle', { name })}</DialogTitle>
        <DialogDescription>{t('settingsIntegrations.connect.accountsIntro', { name })}</DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-1">
        <legend className="sr-only">{t('settingsIntegrations.accounts.heading')}</legend>
        {i.available.map((a) => {
          const on = picked.includes(a.name)
          return (
            <label key={a.name} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
              <Checkbox checked={on} onCheckedChange={(c) => setPicked((p) => (c === true ? [...p, a.name] : p.filter((x) => x !== a.name)))} />
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              <span className="truncate text-xs text-muted-foreground">{a.detail}</span>
            </label>
          )
        })}
      </fieldset>

      {info.ownsContent && (
        <div className="grid gap-1.5">
          <Label htmlFor="connect-owner">{t('settingsIntegrations.accounts.defaultOwner')}</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger id="connect-owner" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {owners.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                  <span className="text-muted-foreground"> · {u.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('settingsIntegrations.accounts.defaultOwnerHelp')}</p>
        </div>
      )}

      {isDemo && <DemoNote text={t('settingsIntegrations.connect.demoAccounts')} />}

      <SaveError error={save.error} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t('settingsIntegrations.cancel')}</Button>
        <Button type="submit" disabled={!ready || save.pending}>{t('settingsIntegrations.connect.submit', { count: picked.length })}</Button>
      </DialogFooter>
    </form>
  )
}

function DemoNote({ text }: { text: string }) {
  return (
    <p className="flex gap-2 rounded-md bg-info-soft px-2.5 py-2 text-xs text-info">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </p>
  )
}

/** Confirm before disconnecting. It says exactly what stops and what stays. */
export function DisconnectDialog({ integration: i, open, onClose }: { integration: Integration; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { disconnect } = useIntegrationUpdate()
  const save = useSave(onClose)
  const name = t(`settingsIntegrations.provider.${i.provider}.name`)
  const info = providerInfo[i.provider]
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settingsIntegrations.disconnect.title', { name })}</DialogTitle>
          <DialogDescription>{t(`settingsIntegrations.disconnect.stops.${info.group}`, { name })}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{t('settingsIntegrations.disconnect.stays')}</p>
        <SaveError error={save.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('settingsIntegrations.cancel')}</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={save.pending}
            onClick={() => void save.run(() => disconnect(i.id))}
          >
            {t('settingsIntegrations.disconnect.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
