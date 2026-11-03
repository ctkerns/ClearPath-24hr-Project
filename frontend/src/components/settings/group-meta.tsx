import { useTranslation } from 'react-i18next'
import { PersonAvatar } from '@/components/materials/material-meta'
import { cn } from '@/lib/utils'
import type { WorkspaceUser } from './user-data'

/** Marks the default group: items that match no routing rule go there (PRD F6). The Routing tab sets it. */
export function DefaultGroupPill({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-primary shadow-[inset_0_0_0_1px_currentColor]', className)}>
      {t('settingsGroups.default')}
    </span>
  )
}

/** Overlapping initials for the first few members, then "+2". The names are in each avatar's tooltip. */
export function MemberStack({ members, max = 4, className }: { members: WorkspaceUser[]; max?: number; className?: string }) {
  const { t } = useTranslation()
  if (!members.length) return <span className={cn('text-xs text-muted-foreground', className)}>{t('settingsGroups.noMembersShort')}</span>
  const extra = members.length - max
  return (
    <span className={cn('flex items-center', className)}>
      <span className="flex -space-x-1.5">
        {members.slice(0, max).map((m) => <PersonAvatar key={m.id} name={m.name} className="size-6 text-[10px] ring-2 ring-background" />)}
      </span>
      {extra > 0 && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">+{extra}</span>}
      <span className="sr-only">{members.map((m) => m.name).join(', ')}</span>
    </span>
  )
}
