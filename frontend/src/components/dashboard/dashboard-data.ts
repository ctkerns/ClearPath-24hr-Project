import type { Issue } from '@/components/issues/issue-data'
import type { Material } from '@/components/materials/material-data'

// What the Dashboard shows for the signed-in person (PRD screen 2): my queue, my submissions, my issues.
// TODO: the API should return these lists per user, so the page does not load the whole workspace.

/** Review deadline for each group (PRD F6, "Deadlines"). TODO: read slaHours from each ReviewerGroup. */
const SLA_BUSINESS_DAYS = 2

/** The date a review is due: the submit time plus two business days. Weekends do not count. */
export function reviewDeadline(submittedAt: string) {
  const d = new Date(submittedAt)
  let left = SLA_BUSINESS_DAYS
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--
  }
  return d
}

/** Whole calendar days until the deadline. Negative means late. */
export function daysToDeadline(deadline: Date) {
  const start = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())
  return Math.round((start(deadline) - start(new Date())) / 86_400_000)
}

/** Materials that wait for a decision from one of my groups, the most urgent first. R1: never my own. */
export function myQueue(materials: Material[], viewer: { name: string; groups: string[] }) {
  return materials
    .filter((m) => (m.status === 'submitted' || m.status === 'in_review') && m.owner !== viewer.name)
    .filter((m) => m.groups.some((g) => viewer.groups.includes(g.name) && g.state === 'waiting'))
    .map((m) => ({ material: m, deadline: reviewDeadline(m.submittedAt ?? m.updatedAt) }))
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
}

/** Materials I own that are not finished, then the rest, newest first. */
export function mySubmissions(materials: Material[], viewer: { name: string }) {
  const done = ['expired', 'retired']
  return materials
    .filter((m) => m.owner === viewer.name && !done.includes(m.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Unresolved issues that I own or that I raised, the soonest due first. */
export function myIssues(issues: Issue[], viewer: { name: string }) {
  return issues
    .filter((i) => i.status !== 'resolved' && (i.owner === viewer.name || i.openedBy === viewer.name))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}
