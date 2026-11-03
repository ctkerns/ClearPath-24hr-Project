import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RiskLevel } from '@/components/ui/risk-tag'
import { api } from '@/lib/api'

// Workspace settings (PRD section 10 "Workspace", F7, F15). Admins only change them.
// This query is the one source of the licensed states and the approval length: the submit form, building blocks,
// routing and decisions all read it, so a Workspace tab save shows everywhere at once.
// It also has the default days to fix an issue (F12), which Managers change in the Issues tab.

/** The 50 states and DC, in the order the picker shows them. */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const

/** PRD F15: the tool warns owners this many days before an approval expires. Fixed, not a setting. */
export const EXPIRY_WARNING_DAYS = 14
/** PRD F9: an approval expires 90 days after approval unless something it depends on changes first. */
export const DEFAULT_APPROVAL_DAYS = 90

/** GET /api/workspace. The server keeps licensedStates in US_STATES order. */
export type WorkspaceSettings = {
  name: string
  isDemo: boolean
  licensedStates: string[]
  approvalDays: number
  /** Default days from raising an issue to its due date, by severity. */
  issueDueDays: Record<RiskLevel, number>
}

/** The bounds the server checks for each issue due day setting. */
export const ISSUE_DUE_DAYS_MAX = 90

const KEY = ['workspace-settings']

export function useWorkspaceSettings() {
  return useQuery({ queryKey: KEY, queryFn: () => api<WorkspaceSettings>('GET', '/workspace') })
}

/** States where the credit union is licensed (PRD F7), in the order the Admin keeps them. Empty while loading. */
export function useLicensedStates(): string[] {
  return useWorkspaceSettings().data?.licensedStates ?? []
}

/** Days from approval to expiry for new approvals (PRD F9, F15). */
export function useApprovalDays(): number {
  return useWorkspaceSettings().data?.approvalDays ?? DEFAULT_APPROVAL_DAYS
}

/** Admins only; the server checks. Rejects with an ApiError, so the form can show what went wrong. */
export function useSaveWorkspaceSettings() {
  const queryClient = useQueryClient()
  return async (change: Partial<Pick<WorkspaceSettings, 'licensedStates' | 'approvalDays'>>) => {
    const saved = await api<WorkspaceSettings>('PATCH', '/workspace', change)
    queryClient.setQueryData(KEY, saved)
  }
}

/** Default days to fix a new issue, by severity (PRD F12). Undefined while loading. */
export function useIssueDueDays(): Record<RiskLevel, number> | undefined {
  return useWorkspaceSettings().data?.issueDueDays
}

/** Managers and Admins; the server checks. Rejects with an ApiError. */
export function useSaveIssueDueDays() {
  const queryClient = useQueryClient()
  return async (days: Partial<Record<RiskLevel, number>>) => {
    const saved = await api<WorkspaceSettings>('PATCH', '/workspace/issue-due-days', days)
    queryClient.setQueryData(KEY, saved)
  }
}

/**
 * Reset demo data (PRD section 11, demo reliability): every query goes back to its seeded state.
 * Today it only resets the TanStack Query cache: data from the seeded JSON files goes back to its first state,
 * and data from the API (users, groups, workspace) loads again from the server, unchanged.
 * TODO: call a server reset for the demo workspace only, then reset the cache the same way.
 */
export function useResetDemo() {
  const queryClient = useQueryClient()
  return () => queryClient.resetQueries()
}
