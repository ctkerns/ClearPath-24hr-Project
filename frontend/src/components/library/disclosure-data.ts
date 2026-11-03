import { useQuery } from '@tanstack/react-query'
import type { Product } from '@/components/materials/material-data'
import type { Rule } from './rule-data'

// Disclosure library (PRD F8): approved disclosure texts, versioned, with the products and states they apply to.
// Managers edit it; everyone else reads it (R3). TODO: replace DISCLOSURES_URL with the real API.
const DISCLOSURES_URL = '/demo/disclosures.json'

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
    queryFn: async (): Promise<Disclosure[]> => {
      const res = await fetch(DISCLOSURES_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).disclosures
    },
    staleTime: Infinity,
  })
}

/** Rules whose code check requires this disclosure. */
export function requiredBy(disclosure: Disclosure, rules: Rule[]) {
  return rules.filter((r) => 'disclosure' in r.check && r.check.disclosure === disclosure.id)
}
