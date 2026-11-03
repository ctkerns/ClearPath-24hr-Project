import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// In-app notifications (PRD F13): assignment, decision, comment, escalation, new issue.
// TODO: replace NOTIFICATIONS_URL with the API endpoint, and send "mark as read" to the server.
// Until then the list loads seeded demo data, and "read" changes last only until the page reloads.
const NOTIFICATIONS_URL = '/demo/notifications.json'

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
    queryFn: async (): Promise<AppNotification[]> => {
      const res = await fetch(NOTIFICATIONS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    // Seeded data has no server state, so never refetch: a refetch would undo "mark as read".
    // Later: refetch on an interval or receive pushes from the API.
    staleTime: Infinity,
  })
}

/** Marks the given notifications as read; with no ids, marks all. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids?: string[]) => ids, // TODO: POST to the API
    onSuccess: (ids) => {
      queryClient.setQueryData<AppNotification[]>(key, (list) =>
        list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)),
      )
    },
  })
}
