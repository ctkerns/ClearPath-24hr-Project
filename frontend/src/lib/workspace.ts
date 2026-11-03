// The workspace the signed-in user is in (PRD A1): one real ClearPath workspace and one demo workspace.
// TODO: read this from the session API when authentication exists (F1). Until then every page
// is in the demo workspace, which is also where demo accounts are limited to.
export type Workspace = {
  id: string
  name: string
  isDemo: boolean
}

const demoWorkspace: Workspace = { id: 'demo', name: 'ClearPath Demo', isDemo: true }

export function useWorkspace(): Workspace {
  return demoWorkspace
}
