import { useQueryClient } from '@tanstack/react-query'
import type { Channel, Material, Product } from '@/components/materials/material-data'
import { uuidv7 } from '@/lib/uuid'
import { demoViewer, versionFields, type MaterialDetail } from '@/components/review/material-detail-data'
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
  /** Demo only keeps file names. TODO: upload to storage and keep the file IDs. */
  files: string[]
  /** The ad image, for channels that have one. */
  imageFiles: string[]
  contentUrl: string
  nationwide: boolean
  states: string[]
  targeting: string
  launchDate: string
  endDate: string
  destinationUrl: string
  proofFiles: string[]
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
 * TODO: the server evaluates the rules on every new version; it also knows the affiliate's history.
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
 * Saves a submission into the demo cache and returns the material ID.
 * TODO: replace with a POST to the API. The server stores files, routes the version, and starts pre-review (F4).
 */
export function useSubmitMaterial() {
  const queryClient = useQueryClient()
  const routing = useRoutingPreview()

  return (values: SubmissionValues, existing?: { material: Material; detail: MaterialDetail | null }) => {
    const now = new Date().toISOString()
    const channel = values.channel as Channel
    const template = channelFields[channel]
    const fields =
      values.source === 'text'
        ? template.filter((f) => values.fields[f.label]?.trim()).map((f) => ({ label: f.label, kind: f.kind, segments: [values.fields[f.label].trim()] }))
        : values.source === 'file'
          ? [{ label: 'Files', segments: [values.files.join(', ')] }]
          : [{ label: 'URL', segments: [values.contentUrl] }]
    const groups = routing.preview(values).map((g) => ({ ...g, state: 'waiting' as const }))
    const prev = existing?.detail
    const number = (prev?.version ?? 0) + 1
    const id = existing?.material.id ?? uuidv7()

    const detail: MaterialDetail = {
      id,
      version: number,
      versionCount: number,
      submittedAt: now,
      submittedBy: demoViewer.name,
      path: 'full',
      details: {
        targetStates: values.nationwide ? 'Nationwide' : values.states.join(', '),
        launchDate: values.launchDate || undefined,
        endDate: values.endDate || undefined,
        destinationUrl: values.destinationUrl || undefined,
        platformId: prev?.details.platformId,
      },
      fields,
      // Findings on the old version become outdated; pre-review adds new ones (F4).
      findings: (prev?.findings ?? []).map((f) => (f.status === 'open' ? { ...f, status: 'outdated' as const } : f)),
      checklist: [],
      groups,
      comments: prev?.comments ?? [],
      versions: [
        ...(prev?.versions ?? []).map((v) => (v.current ? { ...v, current: false, fields: versionFields(prev!, v) } : v)),
        { number, submittedAt: now, submittedBy: demoViewer.name, path: 'full', current: true },
      ],
      history: [
        ...(prev?.history ?? []),
        { at: now, actor: demoViewer.name, type: 'submitted', text: `Submitted version ${number} by manual upload.` },
        { at: now, actor: 'Routing', type: 'routed', text: `Required ${groups.map((g) => `${g.name} (rule "${g.reason}")`).join(', ')}.` },
      ],
      live: prev?.live ?? [],
      issues: prev?.issues ?? [],
    }

    const summary: Material = {
      ...(existing?.material ?? { liveStatus: 'not_live', owner: demoViewer.name }),
      id,
      title: values.title.trim() || existing?.material.title || '',
      channel,
      product: values.product as Product,
      status: 'submitted',
      groups: groups.map((g) => ({ name: g.name, state: g.state })),
      updatedAt: now,
    }

    queryClient.setQueryData(['material-detail', id], detail)
    queryClient.setQueryData<Material[]>(['materials'], (list = []) =>
      existing ? list.map((m) => (m.id === id ? summary : m)) : [summary, ...list],
    )
    return id
  }
}
