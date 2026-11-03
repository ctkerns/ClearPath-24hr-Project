import { useQuery } from '@tanstack/react-query'
import { daysUntil, type Product } from '@/components/materials/material-data'
import { api } from '@/lib/api'

// Pre-approved building blocks (PRD F9). Reviewers save them from approved materials; Managers curate them (R3).
// GET /api/library/building-blocks.

export const BLOCK_KINDS = ['headline', 'claim', 'cta', 'disclosure'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

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
  /** How many materials contain this exact text. TODO: the server keeps a seeded count until materials are in the database. */
  usedIn: number
}

export function useBlocks() {
  return useQuery({
    queryKey: ['building-blocks'],
    queryFn: () => api<Block[]>('GET', '/library/building-blocks'),
  })
}

/** Same thresholds as the materials list: amber within 30 days, red once passed. */
export function expiryState(expiresAt: string): ExpiryState {
  const days = daysUntil(expiresAt)
  return days <= 0 ? 'expired' : days <= 30 ? 'expiring' : 'current'
}

/**
 * "all" on a block means every state where the credit union is licensed: the Workspace settings list
 * (useLicensedStates), passed in so this stays a pure function.
 */
export const blockStates = (b: Block, licensedStates: readonly string[]): string[] => (b.states === 'all' ? [...licensedStates] : b.states)
