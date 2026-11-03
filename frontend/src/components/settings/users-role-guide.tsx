import { Link } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Role } from '@/components/review/material-detail-data'
import { ROLE_ORDER, type WorkspaceUser } from './user-data'
import { RolePill } from './users-meta'

/**
 * The role hierarchy from PRD section 4, as a ladder: each step names only what it adds to the one before.
 * Affiliates sit apart, outside the ladder. The counts are people who are not deactivated.
 */
export function RoleGuide({ users }: { users: WorkspaceUser[] }) {
  const { t } = useTranslation()
  const count = (role: Role) => users.filter((u) => u.role === role && u.status !== 'deactivated').length

  const row = (role: Role, step: string) => (
    <li key={role} className="grid grid-cols-[2.5rem_6.5rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b px-3 py-2 last:border-b-0 max-sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]">
      <span className="text-xs text-muted-foreground tabular-nums">{step}</span>
      <span className="max-sm:col-start-2"><RolePill role={role} /></span>
      <span className="text-xs leading-relaxed max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2">{t(`settingsUsers.roleAdds.${role}`)}</span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums max-sm:col-start-3 max-sm:row-start-1">
        {t('settingsUsers.guide.people', { count: count(role) })}
      </span>
    </li>
  )

  return (
    <section aria-labelledby="role-guide" className="grid gap-2">
      <div className="grid gap-0.5">
        <h2 id="role-guide" className="text-sm font-semibold">{t('settingsUsers.guide.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('settingsUsers.guide.intro')}</p>
      </div>
      <ol className="overflow-hidden rounded-lg border">
        {ROLE_ORDER.map((role, i) => row(role, String(i + 1)))}
        <li aria-hidden="true" className="border-b bg-muted px-3 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t('settingsUsers.guide.outside')}
        </li>
        {row('affiliate', t('settingsUsers.guide.guest'))}
      </ol>
      <ul className="grid gap-1 text-xs text-muted-foreground">
        <li className="flex gap-1.5">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t('settingsUsers.guide.groups')}{' '}
            <Link to="/settings/reviewer-groups" className="font-medium text-primary hover:underline">{t('settingsUsers.guide.groupsLink')}</Link>
          </span>
        </li>
        <li className="flex gap-1.5">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('settingsUsers.guide.ownApproval')}</span>
        </li>
      </ul>
    </section>
  )
}
