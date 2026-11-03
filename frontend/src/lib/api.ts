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

export async function api<T = void>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    // FastAPI sends { detail: string } for its own errors, and { detail: [...] } for invalid input (422).
    // For a 422, show the first problem, like "The expiry date must be in the future", without pydantic's "Value error, ".
    const first = Array.isArray(json?.detail) && typeof json.detail[0]?.msg === 'string' ? json.detail[0].msg.replace(/^Value error, /, '') : null
    const detail = typeof json?.detail === 'string' ? json.detail : (first ?? `HTTP ${res.status}`)
    throw new ApiError(res.status, detail)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}
