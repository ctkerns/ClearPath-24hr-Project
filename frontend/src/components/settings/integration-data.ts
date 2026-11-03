import { useQuery, useQueryClient } from '@tanstack/react-query'
import { uuidv7 } from '@/lib/uuid'
import { hasRole, type WorkspaceUser } from './user-data'

// Connectors (PRD F11, section 7). Each one is real code behind one shared interface:
// listDrafts, getContent, listLive, remediate. A connector does only what its platform supports.
// TODO: replace INTEGRATIONS_URL with the real API. Credentials stay on the server, encrypted per workspace;
// the browser never sees them. The demo workspace has no credentials (PRD A1), so its connectors are seeded.
const INTEGRATIONS_URL = '/demo/integrations.json'

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
  defaultOwnerId?: string
}

export type Integration = {
  id: string
  provider: Provider
  status: IntegrationStatus
  /** Tested against a real account. Built only from documentation means Unverified (PRD F11). */
  verified: boolean
  lastSyncAt?: string
  error?: { code: IntegrationErrorCode; at: string }
  accounts: ConnectedAccount[]
  /** Accounts the platform offers after sign-in. Seeded for the demo; the real list comes from the platform. */
  available: { name: string; detail: string }[]
}

const KEY = ['integrations']

export function useIntegrations() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Integration[]> => {
      const res = await fetch(INTEGRATIONS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).integrations
    },
    // Demo changes live only in this cache (setQueryData), so never refetch over them. TODO: remove with the real API.
    staleTime: Infinity,
  })
}

/**
 * Admin changes to connectors, written to the demo cache.
 * TODO: replace with API calls. The server runs the OAuth flow, stores the token, runs the sync and writes the audit log.
 */
export function useIntegrationUpdate() {
  const queryClient = useQueryClient()
  const now = () => new Date().toISOString()
  const update = (id: string, change: (i: Integration) => Integration) =>
    queryClient.setQueryData<Integration[]>(KEY, (list) => list?.map((i) => (i.id === id ? change(i) : i)))

  return {
    /** Demo: records the sync time only. Nothing is fetched from the platform. */
    syncNow(id: string) {
      update(id, (i) => ({ ...i, lastSyncAt: now() }))
    },
    /** Connect, or reconnect after an error, with the accounts the Admin picked. */
    connect(id: string, accountNames: string[], defaultOwnerId?: string) {
      update(id, (i) => {
        const keep = i.accounts.filter((a) => accountNames.includes(a.name))
        const added = i.available
          .filter((a) => accountNames.includes(a.name) && !keep.some((k) => k.name === a.name))
          .map((a) => ({ id: uuidv7(), ...a, defaultOwnerId }))
        return { ...i, status: 'connected', error: undefined, accounts: [...keep, ...added], lastSyncAt: now() }
      })
    },
    /** Stops intake and monitoring. Materials, issues and history from this connector stay. */
    disconnect(id: string) {
      update(id, (i) => ({ ...i, status: 'not_connected', error: undefined, accounts: [] }))
    },
    setDefaultOwner(id: string, accountId: string, ownerId: string) {
      update(id, (i) => ({ ...i, accounts: i.accounts.map((a) => (a.id === accountId ? { ...a, defaultOwnerId: ownerId } : a)) }))
    },
  }
}

/** People who can be a default owner: active internal users who can submit (they upload fixes and handle issues). */
export function ownerCandidates(users: WorkspaceUser[]) {
  return users.filter((u) => u.status === 'active' && u.role !== 'affiliate' && hasRole(u.role, 'submitter'))
}
