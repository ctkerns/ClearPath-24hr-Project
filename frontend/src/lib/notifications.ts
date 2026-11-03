import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// In-app notifications (PRD F13): assignment, decision, comment, escalation, new issue.
// GET /api/notifications returns only the viewer's own, newest first (up to 50); the page counts the unread ones.
// TODO (F13): Slack and email delivery. Later maybe pushes instead of polling.

export type NotificationType =
  | 'assignment'
  | 'comment'
  | 'escalation'
  | 'issue'
  | 'decision_approved'
  | 'decision_changes_requested'
  | 'decision_rejected'

export type AppNotification = {
  id: string
  type: NotificationType
  actor?: string
  material: string
  materialId?: string
  issueId?: string
  group?: string
  summary?: string
  createdAt: string
  read: boolean
}

const key = ['notifications'] as const

export function useNotifications() {
  return useQuery({
    queryKey: key,
    queryFn: () => api<AppNotification[]>('GET', '/notifications'),
    // No pushes yet: check every minute, and when the window gets focus again.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Marks the given notifications as read; with no ids, marks all of the viewer's. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) => api('POST', '/notifications/read', ids ? { ids } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
