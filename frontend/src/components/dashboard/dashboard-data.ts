import { useQuery } from '@tanstack/react-query'
import type { Issue } from '@/components/issues/issue-data'
import type { Channel, Material } from '@/components/materials/material-data'
import { api } from '@/lib/api'

// What the Dashboard shows for the signed-in person (PRD screen 2). GET /api/dashboard returns only their lists,
// with the review deadlines computed on the server (business days, UTC), so the page does not load the workspace.

/** When a waiting group's review is due (PRD F6 "Deadlines"): the submit time plus the group's target business days. */
export type Deadline = {
  at: string
  targetDays: number
  /** Calendar days to the due day (UTC): 0 is today, 1 tomorrow, negative is late. */
  daysLeft: number
  overdue: boolean
}

export type QueueItem = {
  material: Material
  /** The earliest deadline of my groups that still wait on it: my one decision counts for all of them. */
  deadline: Deadline
  /** My groups that still wait on it. */
  groups: string[]
}

export type Dashboard = {
  /** Materials that wait for one of my groups, late ones first. Absent for a role that reviews nothing. */
  queue?: QueueItem[]
  /** My materials that are not expired or retired, newest first. */
  submissions: Material[]
  /** Unresolved issues that I own or raised, the soonest due first. */
  issues: Issue[]
  /** Problems in the part of the workspace I may see. */
  workspace: {
    liveProblems: number
    overdueIssues: number
    highIssues: number
    /** Approvals that end in the next 30 days, soonest first. */
    expiring: { id: string; title: string; channel: Channel; expiresAt: string }[]
  }
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('GET', '/dashboard'),
  })
}
