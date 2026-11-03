import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Channel, Product } from '@/components/materials/material-data'
import type { MaterialStatus } from '@/components/ui/status-pill'
import type { RateSheetUpload } from './rate-sheet-data'

// Which approved materials a library change flags for re-review (PRD F7, F8, F15). The server decides, from each
// material's approved version: its checklist and findings, product, channel, target states, end date and content.
// Saving the change flags exactly these materials, in the same transaction (backend app/flags.py).

/** An approved or live material that a change flags (a preview), or flagged (an applied regulatory change). */
export type AffectedMaterial = {
  id: string
  title: string
  channel: Channel
  product: Product
  status: MaterialStatus
  /** The approved version the flag is about. */
  version: number
  approvalId?: string
  /** For a rate sheet: the rates the material states that the new sheet no longer covers. */
  rates?: string[]
}

/** Where a rule applies, and from when: what decides which materials depend on an edit. */
export type RuleScope = { jurisdiction: string; products: Product[]; channels: Channel[]; effectiveDate: string }

const enc = encodeURIComponent

/** The approved materials that depend on the rule now. Every internal user can read it. */
export function useRuleDependents(ruleId: string) {
  return useQuery({
    queryKey: ['impact', 'rule', ruleId],
    queryFn: () => api<AffectedMaterial[]>('GET', `/library/rules/${enc(ruleId)}/impact`),
  })
}

/** Managers only: what saving an edit with this scope flags, before saving. Leave out the scope to skip it. */
export function useRuleEditPreview(ruleId: string | undefined, scope: RuleScope | undefined) {
  return useQuery({
    queryKey: ['impact', 'rule-edit', ruleId, scope],
    queryFn: () => api<AffectedMaterial[]>('POST', `/library/rules/${enc(ruleId!)}/impact`, scope),
    enabled: !!ruleId && !!scope,
    placeholderData: keepPreviousData,
  })
}

/** What a new version of the disclosure flags. `effective` is the new version's date, when known. */
export function useDisclosureDependents(disclosureId: string | undefined, effective?: string) {
  const query = effective ? `?effective=${enc(effective)}` : ''
  return useQuery({
    queryKey: ['impact', 'disclosure', disclosureId, effective ?? null],
    queryFn: () => api<AffectedMaterial[]>('GET', `/library/disclosures/${enc(disclosureId!)}/impact${query}`),
    enabled: !!disclosureId,
    placeholderData: keepPreviousData,
  })
}

/** Managers only: what uploading this sheet flags. The server checks the CSV the same way as the upload. */
export function useRateSheetPreview(upload: RateSheetUpload | undefined) {
  return useQuery({
    queryKey: ['impact', 'rate-sheet', upload],
    queryFn: () => api<AffectedMaterial[]>('POST', '/library/rate-sheets/impact', upload),
    enabled: !!upload,
    retry: false, // a bad CSV is a 400; the upload shows the same message
  })
}

/** Undecided: what applying flags. Applied: what it flagged. Dismissed: nothing. */
export function useRegChangeImpact(changeId: string) {
  return useQuery({
    queryKey: ['impact', 'reg-change', changeId],
    queryFn: () => api<AffectedMaterial[]>('GET', `/library/regulatory-changes/${enc(changeId)}/impact`),
  })
}

/** After a library change: the previews, and the flags on the materials, are new. */
export function useAfterFlagging() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['impact'] }),
      queryClient.invalidateQueries({ queryKey: ['materials'] }),
      queryClient.invalidateQueries({ queryKey: ['material-detail'] }),
    ])
}
