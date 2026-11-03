import type * as React from 'react'
import { Check, CircleAlert, Clock, Radio, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { GoogleLogo, MailchimpLogo, MetaLogo, WordPressLogo } from './brand-logos'
import { channelIcons, initials, type Channel, type GroupState, type LiveStatus } from './material-data'

const liveTone: Record<LiveStatus, string> = {
  not_live: 'text-muted-foreground',
  matched: 'text-risk-low',
  changed: 'bg-risk-medium-soft text-risk-medium',
  condition_broken: 'bg-risk-medium-soft text-risk-medium',
  unapproved: 'bg-risk-high-soft text-risk-high',
  expired_approval: 'bg-risk-high-soft text-risk-high',
}

/** What monitoring found for a material on its channel (PRD F10). Problems get a tinted fill. */
export function LiveStatusTag({ status, className }: { status: LiveStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      data-live-status={status}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        liveTone[status],
        className,
      )}
    >
      <Radio className="size-3.5" strokeWidth={2} aria-hidden="true" />
      {t(`materials.liveStatus.${status}`)}
    </span>
  )
}

const groupIcon: Record<GroupState, { icon: typeof Check; tone: string }> = {
  approved: { icon: Check, tone: 'text-risk-low' },
  waiting: { icon: Clock, tone: 'text-muted-foreground' },
  changes: { icon: CircleAlert, tone: 'text-risk-medium' },
  rejected: { icon: X, tone: 'text-risk-high' },
}

/** The required reviewer groups and where each stands, for example "✓ Compliance  ◷ Legal". */
export function GroupApprovals({ groups, className }: { groups: { name: string; state: GroupState }[]; className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5 text-xs', className)}>
      {groups.map((g) => {
        const { icon: Icon, tone } = groupIcon[g.state]
        return (
          <span key={g.name} className="inline-flex items-center gap-1 whitespace-nowrap" title={t(`materials.groupState.${g.state}`, { group: g.name })}>
            <Icon className={cn('size-3.5 shrink-0', tone)} strokeWidth={2.25} aria-hidden="true" />
            <span className={g.state === 'waiting' ? 'text-muted-foreground' : 'text-foreground'}>{g.name}</span>
            <span className="sr-only">{t(`materials.groupStateShort.${g.state}`)}</span>
          </span>
        )
      })}
    </span>
  )
}

const brandLogos: Partial<Record<Channel, (props: { className?: string }) => React.ReactNode>> = {
  meta: MetaLogo,
  google: GoogleLogo,
  mailchimp: MailchimpLogo,
  wordpress: WordPressLogo,
}

/** The platform's own logo when the channel has one, otherwise a plain icon (Affiliate, Other). */
export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const Logo = brandLogos[channel]
  if (Logo) return <Logo className={className} />
  const Icon = channelIcons[channel]
  return <Icon className={cn('size-4 shrink-0 text-muted-foreground', className)} strokeWidth={1.75} aria-hidden="true" />
}

/** Round initials badge for a person. The full name is in the tooltip and for screen readers. */
export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary-strong',
        className,
      )}
    >
      <span aria-hidden="true">{initials(name)}</span>
      <span className="sr-only">{name}</span>
    </span>
  )
}

/**
 * Icon for the Status field: a small status pill (rounded box with a dot), so the menu icon
 * matches how statuses are drawn in the list. Same props as a Lucide icon.
 */
export function StatusFieldIcon({ className, strokeWidth = 1.75, ...props }: React.ComponentProps<'svg'> & { strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true" className={cn('size-4 shrink-0', className)} {...props}>
      <rect x="2.5" y="7" width="19" height="10" rx="2" />
      <circle cx="7.5" cy="12" r="1.75" fill="currentColor" stroke="none" />
      <path d="M11.5 12h6" strokeLinecap="round" />
    </svg>
  )
}
