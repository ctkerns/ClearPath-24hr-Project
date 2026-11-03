import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '@/lib/workspace'

// Workspace settings (PRD section 10 "Workspace", F7, F15). Admins only change them.
// This query is the one source of the licensed states and the approval length: the submit form, building blocks,
// routing and decisions all read it, so a Workspace tab edit (setQueryData) shows everywhere at once.
// TODO: replace WORKSPACE_URL with the real API (Workspace.licensedStates in the data model).
const WORKSPACE_URL = '/demo/workspace.json'

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

export type WorkspaceSettings = {
  name: string
  licensedStates: string[]
  approvalDays: number
}

const KEY = ['workspace-settings']

export function useWorkspaceSettings() {
  const workspace = useWorkspace()
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<WorkspaceSettings> => {
      const res = await fetch(WORKSPACE_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: Partial<WorkspaceSettings> = await res.json()
      return { name: workspace.name, licensedStates: data.licensedStates ?? [], approvalDays: data.approvalDays ?? DEFAULT_APPROVAL_DAYS }
    },
    // Demo changes live only in this cache (setQueryData), so never refetch over them. TODO: remove with the real API.
    staleTime: Infinity,
  })
}

/** States where the credit union is licensed (PRD F7), in the order the Admin keeps them. Empty while loading. */
export function useLicensedStates(): string[] {
  return useWorkspaceSettings().data?.licensedStates ?? []
}

/** Days from approval to expiry for new approvals (PRD F9, F15). */
export function useApprovalDays(): number {
  return useWorkspaceSettings().data?.approvalDays ?? DEFAULT_APPROVAL_DAYS
}

export function useSaveWorkspaceSettings() {
  const queryClient = useQueryClient()
  return (change: Partial<WorkspaceSettings>) =>
    queryClient.setQueryData<WorkspaceSettings>(KEY, (s) => (s ? { ...s, ...change } : s))
}

/**
 * Reset demo data (PRD section 11, demo reliability): every query goes back to its seeded state.
 * All demo changes live only in the TanStack Query cache, so resetting it and refetching the seeded JSON is the reset.
 * Sign-in is not in the cache, so the person stays signed in.
 * TODO: with the real API, call a server reset for the demo workspace only, then reset the cache the same way.
 */
export function useResetDemo() {
  const queryClient = useQueryClient()
  return () => queryClient.resetQueries()
}
