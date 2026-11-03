import type { Role } from '@/components/review/material-detail-data'
import { hasRole } from './user-data'

// PRD screen 9: "Each user sees only the tabs their role can change." The server still checks every request.
export const SETTINGS_TABS = [
  { to: '/settings/users', key: 'users', min: 'admin' },
  { to: '/settings/reviewer-groups', key: 'reviewerGroups', min: 'manager' },
  { to: '/settings/routing', key: 'routing', min: 'manager' },
  // PRD F12, section 4: the default time to fix an issue is compliance policy, which Managers own.
  { to: '/settings/issues', key: 'issues', min: 'manager' },
  { to: '/settings/integrations', key: 'integrations', min: 'admin' },
  { to: '/settings/workspace', key: 'workspace', min: 'admin' },
] as const satisfies readonly { to: string; key: string; min: Role }[]

export function settingsTabsFor(role: Role) {
  return SETTINGS_TABS.filter((tab) => hasRole(role, tab.min))
}
