import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

// The audit log (PRD F12, section 9 AuditEvent): append-only, one entry for each change.
// Every internal user reads it (section 4); affiliates do not. GET /api/audit, newest first.

export type AuditEntity =
  | 'user'
  | 'reviewer_group'
  | 'workspace'
  | 'rule'
  | 'disclosure'
  | 'building_block'
  | 'rate_sheet'
  | 'reg_change'
  | 'routing_rule'
  | 'routing_settings'
  | 'integration'
  | 'product'

export type AuditEvent = {
  /** Pass the last one as `before` to get the next page. */
  id: string
  /** The user's name, or a label such as "Meta connector". */
  actor: string
  /** Null when the actor is not a user. */
  actorId: string | null
  entity: AuditEntity
  entityId: string
  /** For example "created", "updated", "role_changed". */
  action: string
  /** What changed. Often { field: { before, after } }. */
  data: Record<string, unknown> | null
  createdAt: string
}

/** The newest entries (up to `limit`) of one thing, for example useAuditEvents('rule', 'REGZ-1026.24'). */
export function useAuditEvents(entity: AuditEntity, entityId: string, limit = 50) {
  const query = new URLSearchParams({ entity, entityId, limit: String(limit) })
  return useQuery({
    queryKey: ['audit', entity, entityId, limit],
    queryFn: () => api<AuditEvent[]>('GET', `/audit?${query}`),
  })
}
