import { useTranslation } from 'react-i18next'
import type { Role } from '@/components/review/material-detail-data'
import { cn } from '@/lib/utils'
import type { WorkspaceUser } from './user-data'

const pill = 'inline-flex w-fit shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-[inset_0_0_0_1px_currentColor]'

/** Stronger colour for more rights; affiliates, who sit outside the hierarchy, in amber. */
const roleTone: Record<Role, string> = {
  viewer: 'bg-background text-neutral',
  submitter: 'bg-neutral-soft text-neutral',
  reviewer: 'bg-info-soft text-info',
  manager: 'bg-primary-soft text-primary',
  admin: 'bg-primary-soft text-primary-strong',
  affiliate: 'bg-risk-medium-soft text-risk-medium',
}

export function RolePill({ role, className }: { role: Role; className?: string }) {
  const { t } = useTranslation()
  return <span className={cn(pill, roleTone[role], className)}>{t(`roles.${role}`)}</span>
}

const statusTone: Record<WorkspaceUser['status'], string> = {
  active: 'bg-risk-low-soft text-risk-low',
  invited: 'bg-background text-info',
  deactivated: 'bg-neutral-soft text-neutral',
}

export function UserStatusPill({ status, className }: { status: WorkspaceUser['status']; className?: string }) {
  const { t } = useTranslation()
  return <span className={cn(pill, statusTone[status], className)}>{t(`settingsUsers.status.${status}`)}</span>
}
