import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { hasRole, type WorkspaceUser } from './user-data'

// Connectors (PRD F11, section 7). Each one is real code behind one shared interface:
// listDrafts, getContent, listLive, remediate. A connector does only what its platform supports.
// GET /api/integrations, Admins only. The server stores each connector's state; it calls no platform yet.
// TODO: credentials stay on the server, encrypted per workspace; the browser never sees them.
// The demo workspace has no credentials (PRD A1), so its connectors are seeded.

export const PROVIDERS = [
  'meta', 'google_ads', 'mailchimp', 'klaviyo', 'wordpress', 'webflow', 'crawler', 'seed_inbox',
  'impact', 'cj', 'compliance_ai', 'wolters_kluwer', 'slack', 'email_alerts',
] as const
export type Provider = (typeof PROVIDERS)[number]

export type IntegrationStatus = 'connected' | 'not_connected' | 'error'
export type IntegrationErrorCode = 'token_expired' | 'webhook_silent' | 'permission_removed'

/** What a connector is for. One connector can do several of these. */
export type Purpose = 'intake' | 'monitoring' | 'pause' | 'affiliates' | 'regulatory' | 'alerts'

/** Sections of the Integrations tab, in display order. */
export const INTEGRATION_GROUPS = ['channels', 'affiliates', 'regulatory', 'alerts'] as const
export type IntegrationGroup = (typeof INTEGRATION_GROUPS)[number]

type ProviderInfo = {
  group: IntegrationGroup
  /** True when content from this connector becomes materials, so each account needs a default owner (PRD section 4). */
  ownsContent: boolean
  /** The crawler needs no sign-in: it fetches public pages. */
  needsAuth: boolean
}

export const providerInfo: Record<Provider, ProviderInfo> = {
  meta: { group: 'channels', ownsContent: true, needsAuth: true },
  google_ads: { group: 'channels', ownsContent: true, needsAuth: true },
  mailchimp: { group: 'channels', ownsContent: true, needsAuth: true },
  klaviyo: { group: 'channels', ownsContent: true, needsAuth: true },
  wordpress: { group: 'channels', ownsContent: true, needsAuth: true },
  webflow: { group: 'channels', ownsContent: true, needsAuth: true },
  crawler: { group: 'channels', ownsContent: true, needsAuth: false },
  seed_inbox: { group: 'channels', ownsContent: true, needsAuth: true },
  impact: { group: 'affiliates', ownsContent: false, needsAuth: true },
  cj: { group: 'affiliates', ownsContent: false, needsAuth: true },
  compliance_ai: { group: 'regulatory', ownsContent: false, needsAuth: true },
  wolters_kluwer: { group: 'regulatory', ownsContent: false, needsAuth: true },
  slack: { group: 'alerts', ownsContent: false, needsAuth: true },
  email_alerts: { group: 'alerts', ownsContent: false, needsAuth: true },
}

export type ConnectedAccount = {
  id: string
  name: string
  /** What kind of account it is on the platform, for example "Ad account". */
  detail: string
  /** Owner of synced or found-live content with no platform author (PRD section 4, F10). */
  defaultOwnerId?: string | null
}

export type Integration = {
  id: string
  provider: Provider
  status: IntegrationStatus
  /** Tested against a real account. Built only from documentation means Unverified (PRD F11). */
  verified: boolean
  lastSyncAt?: string | null
  error?: { code: IntegrationErrorCode; at: string } | null
  accounts: ConnectedAccount[]
  /** Accounts the platform offers after sign-in. Seeded for the demo; the real list comes from the platform. */
  available: { name: string; detail: string }[]
}

const KEY = ['integrations']

export function useIntegrations() {
  return useQuery({ queryKey: KEY, queryFn: () => api<Integration[]>('GET', '/integrations') })
}

/**
 * Admin changes to connectors. Each call answers with the changed connector, which replaces it in the cache.
 * Each function returns a promise that rejects with an ApiError, so a dialog can show what went wrong.
 * TODO: the server runs the OAuth flow, stores the token, runs the sync and writes the audit log.
 */
export function useIntegrationUpdate() {
  const queryClient = useQueryClient()
  const store = (call: Promise<Integration>) =>
    call.then((saved) => {
      queryClient.setQueryData<Integration[]>(KEY, (list) => list?.map((i) => (i.id === saved.id ? saved : i)))
    })

  return {
    /** Records the sync time only. Nothing is fetched from the platform yet. */
    syncNow: (id: string) => store(api<Integration>('POST', `/integrations/${id}/sync`)),
    /** Connect, or reconnect after an error, with the accounts the Admin picked. */
    connect: (id: string, accountNames: string[], defaultOwnerId?: string) =>
      store(api<Integration>('POST', `/integrations/${id}/connect`, { accountNames, defaultOwnerId })),
    /** Stops intake and monitoring. Materials, issues and history from this connector stay. */
    disconnect: (id: string) => store(api<Integration>('POST', `/integrations/${id}/disconnect`)),
    setDefaultOwner: (id: string, accountId: string, ownerId: string) =>
      store(api<Integration>('PATCH', `/integrations/${id}/accounts/${accountId}`, { defaultOwnerId: ownerId })),
  }
}

/** People who can be a default owner: active internal users who can submit (they upload fixes and handle issues). */
export function ownerCandidates(users: WorkspaceUser[]) {
  return users.filter((u) => u.status === 'active' && u.role !== 'affiliate' && hasRole(u.role, 'submitter'))
}
