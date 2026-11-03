import { useQueryClient } from '@tanstack/react-query'
import type { Channel, Material, Product } from '@/components/materials/material-data'
import { versionFields, type MaterialDetail, type MaterialFile } from '@/components/review/material-detail-data'
import { api, ApiError } from '@/lib/api'
import { useReviewerGroups, type ReviewerGroup } from '@/components/settings/group-data'
import { evaluateRouting, formatList, useRouting, type RoutingRule } from '@/components/settings/routing-data'
import i18n from '@/i18n'

// Shared model for the submit form (PRD F3), used by /materials/new and /materials/$id/new-version.

/** Content fields for each channel, in the order the platform shows them. TODO: come from the connector definitions. */
export const channelFields: Record<Channel, { label: string; multiline?: boolean; kind?: 'image' }[]> = {
  meta: [
    { label: 'Primary text', multiline: true },
    { label: 'Headline' },
    { label: 'Description' },
    { label: 'Call to action' },
    { label: 'Image', kind: 'image' },
  ],
  google: [{ label: 'Headline 1' }, { label: 'Headline 2' }, { label: 'Headline 3' }, { label: 'Description', multiline: true }],
  mailchimp: [{ label: 'Subject line' }, { label: 'Preview text' }, { label: 'Body', multiline: true }],
  wordpress: [{ label: 'Page title' }, { label: 'Body', multiline: true }],
  affiliate: [{ label: 'Page text', multiline: true }],
  other: [{ label: 'Body', multiline: true }],
}

export type ContentSource = 'text' | 'file' | 'url'

export type SubmissionValues = {
  title: string
  channel: Channel | ''
  product: Product | ''
  source: ContentSource
  fields: Record<string, string>
  /** Uploaded as soon as they are picked; the submission refers to their IDs. */
  files: UploadedFile[]
  /** The ad image, for channels that have one. */
  imageFiles: UploadedFile[]
  contentUrl: string
  nationwide: boolean
  states: string[]
  targeting: string
  launchDate: string
  endDate: string
  destinationUrl: string
  proofFiles: UploadedFile[]
}

export type UploadedFile = Pick<MaterialFile, 'id' | 'name'>

/** POST /api/materials/files. The server keeps the file; only people who may see the material can read it. */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/materials/files', { method: 'POST', body: form })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new ApiError(res.status, typeof json?.detail === 'string' ? json.detail : `HTTP ${res.status}`)
  }
  return res.json()
}

export const emptyValues: SubmissionValues = {
  title: '', channel: '', product: '', source: 'text', fields: {}, files: [], imageFiles: [], contentUrl: '',
  nationwide: false, states: [], targeting: '', launchDate: '', endDate: '', destinationUrl: '', proofFiles: [],
}

/** Starting values for a new version: the current version's content and details. */
export function valuesFromMaterial(m: Material, detail: MaterialDetail | null): SubmissionValues {
  const current = detail?.versions.find((v) => v.current)
  const fields = detail && current ? Object.fromEntries(versionFields(detail, current).map((f) => [f.label, f.text])) : {}
  const states = detail?.details.targetStates ?? ''
  return {
    ...emptyValues,
    title: m.title,
    channel: m.channel,
    product: m.product,
    fields,
    nationwide: states === 'Nationwide',
    states: states && states !== 'Nationwide' ? states.split(/,\s*/) : [],
    launchDate: detail?.details.launchDate ?? '',
    endDate: detail?.details.endDate ?? '',
    destinationUrl: detail?.details.destinationUrl ?? '',
  }
}

/**
 * Which reviewer groups a submission goes to (PRD F6), so the form can show it before you submit.
 * It runs the Routing tab's rules and default group through evaluateRouting, the same function as "Test routing".
 * The submit sends the result; the server checks that the groups exist, and uses the default group when there are none.
 * TODO: the server evaluates the rules on every new version, once they are in the database; it also knows the affiliate's history.
 */
export function previewRouting(rules: RoutingRule[], groups: ReviewerGroup[], v: SubmissionValues): { name: string; reason: string }[] {
  if (!v.product || !v.channel) return []
  const result = evaluateRouting(rules, groups.find((g) => g.isDefault)?.id, {
    product: v.product,
    channel: v.channel,
    // Affiliate pages come from affiliates, as in "Test routing". The demo does not know an affiliate's history.
    source: v.channel === 'affiliate' ? 'affiliate' : 'internal',
    affiliateHistory: false,
    nationwide: v.nationwide,
    states: v.states,
  })
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.name ?? id
  return result.required.flatMap(({ groupId, ruleIds }) => {
    const group = groups.find((g) => g.id === groupId)
    if (!group) return []
    return [{ name: group.name, reason: ruleIds.length ? formatList(ruleIds.map(ruleName), 'conjunction') : i18n.t('submit.routingDefault') }]
  })
}

/** The routing rules and reviewer groups that previewRouting reads, from the Settings data. */
export function useRoutingPreview() {
  const routing = useRouting()
  const groups = useReviewerGroups()
  const ready = !!routing.data && !!groups.data
  return { ready, preview: (v: SubmissionValues) => (ready ? previewRouting(routing.data!.rules, groups.data!, v) : []) }
}

/** What is missing before the form can be sent. Keys are field names, values are i18n keys. */
export function validate(v: SubmissionValues, isNewVersion: boolean) {
  const errors: Partial<Record<'title' | 'channel' | 'product' | 'content' | 'states' | 'endDate', string>> = {}
  if (!isNewVersion && !v.title.trim()) errors.title = 'submit.errors.title'
  if (!v.channel) errors.channel = 'submit.errors.channel'
  if (!v.product) errors.product = 'submit.errors.product'
  const hasContent =
    v.source === 'text' ? Object.values(v.fields).some((x) => x.trim()) : v.source === 'file' ? v.files.length > 0 : /^https?:\/\/\S+\.\S+/.test(v.contentUrl)
  if (!hasContent) errors.content = `submit.errors.content.${v.source}`
  if (!v.nationwide && v.states.length === 0) errors.states = 'submit.errors.states'
  if (v.launchDate && v.endDate && v.endDate < v.launchDate) errors.endDate = 'submit.errors.endDate'
  return errors
}


/**
 * Sends a submission: POST /api/materials for a new material, POST /api/materials/<id>/versions for a new version.
 * Resolves with the material ID, and rejects with an ApiError, so the form can show what went wrong.
 * The server stores the version, routes it, and moves the material to In review. TODO (F4): pre-review.
 */
export function useSubmitMaterial() {
  const queryClient = useQueryClient()
  const routing = useRoutingPreview()

  return async (values: SubmissionValues, existing?: { material: Material }) => {
    const channel = values.channel as Channel
    const fields =
      values.source === 'text'
        ? channelFields[channel].map((f) => ({ label: f.label, kind: f.kind, text: values.fields[f.label]?.trim() ?? '' })).filter((f) => f.text)
        : values.source === 'file'
          ? [{ label: 'Files', text: values.files.map((f) => f.name).join(', ') }]
          : [{ label: 'URL', text: values.contentUrl.trim() }]
    const files = [...(values.source === 'file' ? values.files : []), ...(values.source === 'text' ? values.imageFiles : []), ...values.proofFiles]
    const body = {
      title: values.title.trim(),
      channel,
      product: values.product,
      fields,
      fileIds: files.map((f) => f.id),
      nationwide: values.nationwide,
      states: values.nationwide ? [] : values.states,
      targeting: values.targeting,
      launchDate: values.launchDate || null,
      endDate: values.endDate || null,
      destinationUrl: values.destinationUrl,
      groups: routing.preview(values),
    }
    const detail = existing
      ? await api<MaterialDetail>('POST', `/materials/${existing.material.id}/versions`, body)
      : await api<MaterialDetail>('POST', '/materials', body)
    queryClient.setQueryData(['material-detail', detail.id], detail)
    await queryClient.invalidateQueries({ queryKey: ['materials'] })
    return detail.id
  }
}
