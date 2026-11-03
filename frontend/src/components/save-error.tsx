/** The server's message after a failed save, above the dialog buttons. Screen readers announce it. */
export function SaveError({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-md border border-destructive/30 bg-risk-high-soft px-3 py-2 text-xs text-destructive">
      {error}
    </p>
  )
}
