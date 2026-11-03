import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { FileText, Globe, Handshake, Mail, Megaphone, Search, type LucideIcon } from 'lucide-react'
import type { MaterialStatus } from '@/components/ui/status-pill'

// Materials repository data (PRD F2). GET /api/materials.
// The server filters by role: an Affiliate gets only their own company's materials (PRD R4).

export const STATUSES = [
  'draft', 'submitted', 'in_review', 'changes_requested', 'rejected', 'approved', 'live', 'expired', 'retired',
] as const satisfies readonly MaterialStatus[]

/** Live status values from PRD F10. Problems come first, so they sort to the top. */
export const LIVE_STATUSES = ['unapproved', 'changed', 'condition_broken', 'expired_approval', 'matched', 'not_live'] as const
export type LiveStatus = (typeof LIVE_STATUSES)[number]
export const LIVE_PROBLEMS: LiveStatus[] = ['unapproved', 'changed', 'condition_broken', 'expired_approval']

export const CHANNELS = ['meta', 'google', 'mailchimp', 'wordpress', 'affiliate', 'other'] as const
export type Channel = (typeof CHANNELS)[number]
export const channelIcons: Record<Channel, LucideIcon> = {
  meta: Megaphone,
  google: Search,
  mailchimp: Mail,
  wordpress: Globe,
  affiliate: Handshake,
  other: FileText,
}

export const PRODUCTS = ['personal_loan', 'credit_card', 'mortgage', 'heloc', 'auto_loan', 'savings'] as const
export type Product = (typeof PRODUCTS)[number]

/** Where one required reviewer group stands on the current version (PRD F6). */
export type GroupState = 'waiting' | 'approved' | 'changes' | 'rejected'

export type Material = {
  id: string
  title: string
  channel: Channel
  product: Product
  status: MaterialStatus
  liveStatus: LiveStatus
  groups: { name: string; state: GroupState }[]
  owner: string
  affiliate?: string
  source?: 'found_live'
  approvalId?: string
  expiresAt?: string
  /** When the current version was submitted. Only set while it waits for review. */
  submittedAt?: string
  updatedAt: string
}

export function useMaterials() {
  return useQuery({
    queryKey: ['materials'],
    queryFn: () => api<Material[]>('GET', '/materials'),
  })
}

/** "Priya Shah" becomes "PS". */
export function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

/** Whole days from now until a date. Zero or less means the date has passed. */
export function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
}
