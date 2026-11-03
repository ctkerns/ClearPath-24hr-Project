import { useViewer } from '@/lib/session'

// The workspace of the signed-in user (PRD A1): one real ClearPath workspace and one demo workspace.
// It comes with the session (GET /api/auth/me), so it is there on every page without a second request.
export type Workspace = {
  id: string
  name: string
  isDemo: boolean
}

export function useWorkspace(): Workspace {
  const viewer = useViewer()
  return { id: viewer.workspaceId, name: viewer.workspaceName, isDemo: viewer.isDemo }
}
