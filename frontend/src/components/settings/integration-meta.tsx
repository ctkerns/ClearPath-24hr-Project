import { BellRing, Globe, Handshake, Hash, Inbox, Mail, Scale, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Channel } from '@/components/materials/material-data'
import { ChannelIcon } from '@/components/materials/material-meta'
import { systemActors } from '@/components/review/system-actors'
import { cn } from '@/lib/utils'
import type { IntegrationStatus, Provider, Purpose } from './integration-data'

// The four channel platforms use their brand logo, the same as in the materials list.
const channelOf: Partial<Record<Provider, Channel>> = { meta: 'meta', google_ads: 'google', mailchimp: 'mailchimp', wordpress: 'wordpress' }

// Every other connector gets a plain icon, so the list stays a list and not a wall of logos.
const providerIcons: Partial<Record<Provider, LucideIcon>> = {
  klaviyo: Mail,
  webflow: Globe,
  crawler: systemActors.Monitoring,
  seed_inbox: Inbox,
  impact: Handshake,
  cj: Handshake,
  compliance_ai: Scale,
  wolters_kluwer: Scale,
  slack: Hash,
  email_alerts: BellRing,
}

export function IntegrationIcon({ provider, className }: { provider: Provider; className?: string }) {
  const channel = channelOf[provider]
  if (channel) return <ChannelIcon channel={channel} className={className} />
  const Icon = providerIcons[provider] ?? Globe
  return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} strokeWidth={1.75} aria-hidden="true" />
}

const tone: Record<IntegrationStatus, string> = {
  connected: 'bg-risk-low-soft text-risk-low',
  not_connected: 'bg-background text-muted-foreground',
  error: 'bg-risk-high-soft text-risk-high',
}

/** Connection status (PRD F11). Same outlined shape as the other status pills. */
export function IntegrationStatusPill({ status, className }: { status: IntegrationStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-slot="integration-status-pill"
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]',
        tone[status],
        className,
      )}
    >
      {t(`settingsIntegrations.status.${status}`)}
    </span>
  )
}

/** Verified: tested against a real account. Unverified: built from the platform's documentation only. */
export function VerifiedLabel({ verified, className }: { verified: boolean; className?: string }) {
  const { t } = useTranslation()
  const Icon = verified ? ShieldCheck : ShieldQuestion
  const key = verified ? 'verified' : 'unverified'
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs whitespace-nowrap', verified ? 'text-foreground' : 'text-muted-foreground', className)}
      title={t(`settingsIntegrations.${key}Hint`)}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {t(`settingsIntegrations.${key}`)}
    </span>
  )
}

/** What the connector does, one line per purpose: Intake, Monitoring, Actions, and so on. */
export function PurposeList({ provider, className }: { provider: Provider; className?: string }) {
  const { t } = useTranslation()
  const does = t(`settingsIntegrations.provider.${provider}.does`, { returnObjects: true }) as Partial<Record<Purpose, string>>
  return (
    <dl className={cn('grid gap-1 text-sm', className)}>
      {(Object.entries(does) as [Purpose, string][]).map(([purpose, text]) => (
        <div key={purpose} className="flex gap-3">
          <dt className="w-24 shrink-0 text-muted-foreground">{t(`settingsIntegrations.purpose.${purpose}`)}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  )
}
