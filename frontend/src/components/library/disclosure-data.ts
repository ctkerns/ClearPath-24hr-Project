import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Product } from '@/components/materials/material-data'
import { useAfterFlagging } from './impact-data'
import type { Rule } from './rule-data'

// Disclosure library (PRD F8): approved disclosure texts, versioned, with the products and states they apply to.
// Managers edit it; every internal user reads it (R3). GET /api/library/disclosures.

export type Disclosure = {
  /** Internal reference that rules use (for example in a trigger-term check). Only shown in URLs. */
  id: string
  title: string
  version: number
  /** The exact approved text. Materials must use it word for word. */
  text: string
  /** Empty means every product. */
  products: Product[]
  states: 'all' | string[]
  /** Where and how the text must appear. */
  placement: string
  effectiveDate: string
  owner: string
  /** Newest first. */
  versions: { version: number; effectiveDate: string; by: string; note: string; text: string }[]
}

export function useDisclosures() {
  return useQuery({
    queryKey: ['disclosures'],
    queryFn: () => api<Disclosure[]>('GET', '/library/disclosures'),
  })
}

/** Rules whose code check requires this disclosure. */
export function requiredBy(disclosure: Disclosure, rules: Rule[]) {
  return rules.filter((r) => 'disclosure' in r.check && r.check.disclosure === disclosure.id)
}

/** The body of POST and PATCH /api/library/disclosures. `note` says what changed, for the version history. */
export type DisclosureInput = Pick<Disclosure, 'title' | 'text' | 'products' | 'states' | 'placement' | 'effectiveDate'> & { note: string }

/**
 * Managers only (R3); the server checks. Create makes version 1; each edit makes the next version and keeps the old text.
 * An edit also flags the approved materials that depend on the old version for re-review (F7, F15), so those reload too.
 * Each resolves with the saved disclosure, or rejects with an ApiError, so the dialog can show what went wrong.
 */
export function useDisclosureUpdate() {
  const queryClient = useQueryClient()
  const afterFlagging = useAfterFlagging()
  const after = async (d: Disclosure) => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['disclosures'] }), afterFlagging()])
    return d
  }
  return {
    create: (id: string, input: DisclosureInput) => api<Disclosure>('POST', '/library/disclosures', { id, ...input }).then(after),
    edit: (id: string, input: DisclosureInput) =>
      api<Disclosure>('PATCH', `/library/disclosures/${encodeURIComponent(id)}`, input).then(after),
  }
}

/** True when another disclosure already uses this ID. */
export const disclosureIdTaken = (disclosures: Disclosure[], id: string) => disclosures.some((d) => d.id === id.trim())
