import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Channel, Material, Product } from '@/components/materials/material-data'
import { versionFields, type MaterialDetail, type MaterialFile } from '@/components/review/material-detail-data'
import { api, ApiError } from '@/lib/api'
import { formatList } from '@/components/settings/routing-data'
import i18n from '@/i18n'

// Shared model for the submit form (PRD F3), used by /materials/new and /materials/$id/new-version.

/** One content field of a channel. The image field's text is the text in the ad image. */
export type ChannelField = { label: string; multiline: boolean; kind?: 'image' }
export type ChannelFields = Record<Channel, ChannelField[]>

/**
 * GET /api/channels: the content fields of each channel, in the order the platform shows them.
 * They come from the server (app/channels.py), which accepts a submission only with these fields.
 */
const channelFieldsQuery = queryOptions({
  queryKey: ['channel-fields'],
  queryFn: async () => {
    const list = await api<{ channel: Channel; fields: ChannelField[] }[]>('GET', '/channels')
    return Object.fromEntries(list.map((c) => [c.channel, c.fields])) as ChannelFields
  },
  staleTime: Infinity, // fixed for the life of a release
})

/** The content fields of each channel. Undefined while they load. */
export function useChannelFields(): ChannelFields | undefined {
  return useQuery(channelFieldsQuery).data
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

/** POST /api/routing/preview: the groups the server would require, with the rules that require each one. */
type RoutingPreview = { path: 'full' | 'lighter'; groups: { name: string; reason: string; rules: string[] }[] }

/**
 * Which reviewer groups a submission goes to (PRD F6), so the form can show it before you submit.
 * This is only a preview: the server decides the groups on submit, from its own data, and the submit
 * does not send them (PRD R2). The preview asks the server, so it runs the same code as the decision.
 * Affiliates use it too: they cannot read the Routing tab. For a new version, `materialId` gives the server
 * the material's channel and affiliate. The Routing tab's "Test routing" still uses evaluateRouting.
 */
export function useRoutingPreview(v: SubmissionValues, materialId?: string) {
  const input = {
    materialId: materialId ?? null,
    channel: v.channel,
    product: v.product,
    nationwide: v.nationwide,
    states: v.nationwide ? [] : v.states,
  }
  const enabled = !!v.product && !!v.channel && (v.nationwide || v.states.length > 0)
  const query = useQuery({
    queryKey: ['routing-preview', input],
    queryFn: () => api<RoutingPreview>('POST', '/routing/preview', input),
    enabled,
    placeholderData: keepPreviousData, // no flicker while the next answer loads
  })
  if (!enabled || !query.data) return []
  return query.data.groups.map((g) => ({
    name: g.name,
    reason: g.rules.length ? formatList(g.rules, 'conjunction') : i18n.t('submit.routingDefault'),
  }))
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
 * The server checks the content fields against the channel, stores the version, routes it (it alone decides the groups),
 * runs the code checks of the pre-review (PRD F4), and moves the material to In review.
 */
export function useSubmitMaterial() {
  const queryClient = useQueryClient()

  return async (values: SubmissionValues, existing?: { material: Material }) => {
    const channel = values.channel as Channel
    // Only this channel's fields: a new version can start from content with other labels.
    const channelFields = await queryClient.ensureQueryData(channelFieldsQuery)
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
      // No groups: the server evaluates the routing rules itself (PRD R2, F6).
    }
    const detail = existing
      ? await api<MaterialDetail>('POST', `/materials/${existing.material.id}/versions`, body)
      : await api<MaterialDetail>('POST', '/materials', body)
    queryClient.setQueryData(['material-detail', detail.id], detail)
    await queryClient.invalidateQueries({ queryKey: ['materials'] })
    return detail.id
  }
}
