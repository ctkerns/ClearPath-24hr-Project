import type { MaterialDetail } from './material-detail-data'

/**
 * What the checks on the current version did, so no screen shows "0 open findings" as a clean result
 * when nothing was checked yet, or at all.
 * - no_rules: the checklist is empty. Nothing was checked; a reviewer must check the content by hand.
 * - running: the AI review still runs in the background (rows "pending"). Findings may still appear.
 * - ai_not_run: the AI review did not run (rows "not_run"). Only the code checks ran.
 * - done: every rule on the checklist was checked.
 * `checked` counts the rules that passed or failed.
 */
export type CheckState =
  | { kind: 'no_rules' }
  | { kind: 'running'; checked: number }
  | { kind: 'ai_not_run'; checked: number; reason?: string }
  | { kind: 'done'; checked: number }

// The server writes the note as "AI review unavailable: <reason>. Check this rule by hand." (app.ai_review.unavailable_note)
const NOTE = /^AI review unavailable: (.+?)\. Check this rule by hand\.$/

export function checkState(checklist: MaterialDetail['checklist']): CheckState {
  if (checklist.length === 0) return { kind: 'no_rules' }
  const checked = checklist.filter((r) => r.result === 'pass' || r.result === 'fail').length
  if (checklist.some((r) => r.result === 'pending')) return { kind: 'running', checked }
  const notRun = checklist.find((r) => r.result === 'not_run')
  if (notRun) return { kind: 'ai_not_run', checked, reason: notRun.note?.match(NOTE)?.[1] }
  return { kind: 'done', checked }
}
