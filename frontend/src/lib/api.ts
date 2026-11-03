// One way to call the backend. The session cookie goes with every request automatically (same origin).

/** A failed API call. `detail` is the server's message, for example "Another group already uses this name". */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
    this.detail = detail
  }
}

// Pages that work without a session. A 401 there is a normal answer, not an ended session.
const PUBLIC_PATHS = ['/sign-in', '/accept-invite']
let leaving = false

/**
 * The session ended (expired, signed out in another tab, or deactivated): go to sign-in, and come back here after.
 * A full page load, like sign-out, so no page keeps data of the old session. Many calls can fail at once; only the first one leaves.
 */
function goToSignIn() {
  if (leaving) return
  leaving = true
  const here = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(`/sign-in?redirect=${encodeURIComponent(here)}`)
}

export async function api<T = void>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401 && !PUBLIC_PATHS.includes(window.location.pathname)) {
    goToSignIn()
    // Never settles: the page is about to change, so no error message flashes first.
    return new Promise<T>(() => {})
  }
  if (!res.ok) throw await errorOf(res)
  return (res.status === 204 ? undefined : await res.json()) as T
}

async function errorOf(res: Response): Promise<ApiError> {
  const json = await res.json().catch(() => null)
  // FastAPI sends { detail: string } for its own errors, and { detail: [...] } for invalid input (422).
  // For a 422, show the first problem, like "The expiry date must be in the future", without pydantic's "Value error, ".
  const first = Array.isArray(json?.detail) && typeof json.detail[0]?.msg === 'string' ? json.detail[0].msg.replace(/^Value error, /, '') : null
  const detail = typeof json?.detail === 'string' ? json.detail : (first ?? `HTTP ${res.status}`)
  return new ApiError(res.status, detail)
}

/**
 * POSTs the body and saves the file that the server sends back (its Content-Disposition names it).
 * For a download that is also an action the server records, like the regulator export, so it cannot be a plain link.
 */
export async function apiDownload(path: string, body: unknown): Promise<void> {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.status === 401) {
    goToSignIn()
    return new Promise<void>(() => {})
  }
  if (!res.ok) throw await errorOf(res)
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download'
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  // Revoke later: some browsers start reading the blob only after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
