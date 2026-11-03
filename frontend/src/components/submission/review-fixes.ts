import { useState } from 'react'
import type { Finding, MaterialDetail } from '@/components/review/material-detail-data'
import type { ChannelField } from './submission-model'

// The fixes from the review of the current version (PRD F4), for the new-version form (PRD F3).
// A finding with an `edit` has an exact fix that the form applies with one click. The others need the
// submitter's own words, so the form lists them with their advice.

/** One exact change to the content. Findings that ask for the same change (one disclosure, two rules) share it. */
export type ReviewFix = {
  id: string
  findings: Finding[]
  /** The field label the change goes into. */
  field: string
  op: 'replace' | 'append'
  /** The flagged text that goes away ('' for append). */
  from: string
  /** The text that comes in ('' removes the flagged text). */
  to: string
  /** Where `from` starts in the field text of the current version. */
  at: number
  /** The AI wrote this new wording for a code finding, so the panel labels it. */
  byAi?: boolean
}

export type ReviewFixes = {
  fixes: ReviewFix[]
  /** Open findings without an exact fix: the submitter writes those changes. */
  manual: Finding[]
  /** Finding number (1, 2, …), the same as the marks on the material page. */
  numbers: Map<string, number>
}

/**
 * The fixes of the open findings. A replace goes where the finding's mark is in the content; text in an image
 * does not get one, because the image needs a new file. An append goes into the last text field of the channel
 * (the body, where disclosures usually are).
 */
export function reviewFixes(detail: MaterialDetail, channelFields: ChannelField[]): ReviewFixes {
  const open = detail.findings.filter((f) => f.status === 'open')
  const numbers = new Map(open.map((f, i) => [f.id, i + 1]))
  const marks = new Map<string, { field: string; at: number }>()
  for (const field of detail.fields) {
    if (field.kind === 'image') continue
    let at = 0
    for (const s of field.segments) {
      const text = typeof s === 'string' ? s : s.text
      if (typeof s !== 'string') marks.set(s.finding, { field: field.label, at })
      at += text.length
    }
  }
  const textFields = channelFields.filter((f) => f.kind !== 'image')
  const appendTo = (textFields.findLast((f) => f.multiline) ?? textFields.at(-1))?.label

  const fixes: ReviewFix[] = []
  const manual: Finding[] = []
  for (const f of open) {
    const mark = marks.get(f.id)
    if (f.edit?.op === 'replace' && mark) {
      fixes.push({ id: f.id, findings: [f], field: mark.field, op: 'replace', from: f.text, to: f.edit.text, at: mark.at, byAi: f.source === 'code' && f.edit.by === 'ai' })
    } else if (f.edit?.op === 'append' && appendTo) {
      const same = fixes.find((x) => x.op === 'append' && x.to === f.edit?.text)
      if (same) same.findings.push(f)
      else fixes.push({ id: f.id, findings: [f], field: appendTo, op: 'append', from: '', to: f.edit.text, at: -1 })
    } else {
      manual.push(f)
    }
  }
  return { fixes, manual, numbers }
}

/** Where an applied fix put its text, so Undo can take it out again. */
type Applied = { field: string; index: number; from: string; to: string }
type Fields = Record<string, string>

/** The occurrence of `text` nearest to `at`, or -1. */
function nearest(value: string, text: string, at: number) {
  let best = -1
  for (let i = value.indexOf(text); i >= 0; i = value.indexOf(text, i + 1)) {
    if (best < 0 || Math.abs(i - at) < Math.abs(best - at)) best = i
  }
  return best
}

/**
 * Puts `to` in place of `length` characters at `index`. Removing text also removes the comma and space before it
 * when nothing follows ("$500 cash, X" becomes "$500 cash"), or the space after it at the start of a line.
 */
function splice(value: string, index: number, length: number, to: string) {
  let start = index
  let end = index + length
  if (!to) {
    const before = /[,;]?[ \t]+$/.exec(value.slice(0, start))
    if (before && (end >= value.length || /[\s.,;:!?]/.test(value[end]))) start -= before[0].length
    else if ((start === 0 || value[start - 1] === '\n') && value[end] === ' ') end += 1
  }
  return { value: value.slice(0, start) + to + value.slice(end), index: start, removed: value.slice(start, end) }
}

function apply(fields: Fields, fix: ReviewFix): { fields: Fields; applied: Applied } | null {
  const value = fields[fix.field] ?? ''
  if (fix.op === 'append') {
    if (value.includes(fix.to)) return null
    const base = value.trimEnd()
    // A new paragraph in a multi-line text; else a new sentence, so the text before it gets its full stop.
    const sep = !base ? '' : base.includes('\n') ? '\n\n' : /[.!?:]$/.test(base) ? ' ' : '. '
    const next = base + sep + fix.to
    return { fields: { ...fields, [fix.field]: next }, applied: { field: fix.field, index: base.length, from: value.slice(base.length), to: sep + fix.to } }
  }
  const i = nearest(value, fix.from, fix.at)
  if (i < 0) return null
  const s = splice(value, i, fix.from.length, fix.to)
  return { fields: { ...fields, [fix.field]: s.value }, applied: { field: fix.field, index: s.index, from: s.removed, to: fix.to } }
}

function undo(fields: Fields, a: Applied): Fields | null {
  const value = fields[a.field] ?? ''
  // The person may have typed in the field since: look for the applied text near where it went.
  const i = value.slice(a.index, a.index + a.to.length) === a.to ? a.index : a.to ? nearest(value, a.to, a.index) : -1
  if (i < 0) return null
  return { ...fields, [a.field]: value.slice(0, i) + a.from + value.slice(i + a.to.length) }
}

/** Moves the recorded places of the other applied fixes in a field after a change at `index`. */
function shift(applied: Record<string, Applied>, field: string, index: number, delta: number, except: string) {
  return Object.fromEntries(
    Object.entries(applied).map(([id, a]) => [id, id !== except && a.field === field && a.index > index ? { ...a, index: a.index + delta } : a]),
  )
}

/** Applies every fix it can, last place first, so the earlier places stay where they were. */
export function applyAll(fields: Fields, fixes: ReviewFix[], applied: Record<string, Applied> = {}) {
  let next = fields
  let done = applied
  const order = [...fixes].filter((f) => !done[f.id]).sort((a, b) => a.field.localeCompare(b.field) || b.at - a.at)
  for (const fix of order) {
    const r = apply(next, fix)
    if (!r) continue
    done = { ...shift(done, fix.field, r.applied.index, r.applied.to.length - r.applied.from.length, fix.id), [fix.id]: r.applied }
    next = r.fields
  }
  return { fields: next, applied: done }
}

/** True when an append's text is in the field already, so there is nothing to add. */
export const alreadyThere = (fields: Fields, fix: ReviewFix) => fix.op === 'append' && (fields[fix.field] ?? '').includes(fix.to)

/**
 * The form's state for the fixes: which ones are applied, and where. The form owns the field values;
 * this hook changes them through `setFields`, and the person can still edit the text after.
 */
export function useReviewFixes(fixes: ReviewFix[], initial: Record<string, Applied>, fields: Fields, setFields: (f: Fields) => void) {
  const [applied, setApplied] = useState(initial)
  // A fix whose text the person changed by hand can no longer be applied or undone here.
  const [stuck, setStuck] = useState<Set<string>>(new Set())
  const fail = (ids: string[]) => ids.length && setStuck((s) => new Set([...s, ...ids]))

  const toggle = (fix: ReviewFix, on: boolean) => {
    if (on) {
      const r = apply(fields, fix)
      if (!r) return fail([fix.id])
      const delta = r.applied.to.length - r.applied.from.length
      setApplied({ ...shift(applied, fix.field, r.applied.index, delta, fix.id), [fix.id]: r.applied })
      return setFields(r.fields)
    }
    const a = applied[fix.id]
    const next = a && undo(fields, a)
    if (!next) return fail([fix.id])
    const { [fix.id]: _, ...rest } = applied
    setApplied(shift(rest, a.field, a.index, a.from.length - a.to.length, fix.id))
    setFields(next)
  }

  const all = () => {
    const r = applyAll(fields, fixes, applied)
    fail(fixes.filter((f) => !r.applied[f.id] && !alreadyThere(fields, f)).map((f) => f.id))
    setApplied(r.applied)
    setFields(r.fields)
  }

  return { applied, stuck, toggle, all }
}

export type { Applied as AppliedFix }
