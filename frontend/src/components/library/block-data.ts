import { useQuery } from '@tanstack/react-query'
import { daysUntil, type Product } from '@/components/materials/material-data'

// Pre-approved building blocks (PRD F9). Reviewers save them from approved materials; Managers curate them (R3).
// TODO: replace BLOCKS_URL with the real API.
const BLOCKS_URL = '/demo/building-blocks.json'

export const BLOCK_KINDS = ['headline', 'claim', 'cta', 'disclosure'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

// "all" on a block means every state where the credit union is licensed (one shared list, kept by an Admin).
import { LICENSED_STATES } from '@/components/submission/submission-model'
export { LICENSED_STATES }

export const EXPIRY_STATES = ['current', 'expiring', 'expired'] as const
export type ExpiryState = (typeof EXPIRY_STATES)[number]

export type Block = {
  id: string
  kind: BlockKind
  /** The exact approved text. The tool finds a block in a material by this text (F9). */
  text: string
  /** Empty means every product. */
  products: Product[]
  states: 'all' | string[]
  approvedBy: string
  approvedAt: string
  expiresAt: string
  /** The approved material the block was saved from with "Save to library". */
  savedFrom: { id: string; title: string }
  /** How many materials contain this exact text. */
  usedIn: number
}

export function useBlocks() {
  return useQuery({
    queryKey: ['building-blocks'],
    queryFn: async (): Promise<Block[]> => {
      const res = await fetch(BLOCKS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).blocks
    },
    staleTime: Infinity,
  })
}

/** Same thresholds as the materials list: amber within 30 days, red once passed. */
export function expiryState(expiresAt: string): ExpiryState {
  const days = daysUntil(expiresAt)
  return days <= 0 ? 'expired' : days <= 30 ? 'expiring' : 'current'
}

export const blockStates = (b: Block): string[] => (b.states === 'all' ? [...LICENSED_STATES] : b.states)
