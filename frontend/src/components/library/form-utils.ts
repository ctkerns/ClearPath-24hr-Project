// Small helpers for the library editors (PRD F7, F8, F9). The limits match backend/src/app/library.py.

/** A short ID that people read, like "REGZ-1026.24" or "D-7". It is part of URLs, so no spaces or slashes. */
export const TEXT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Title and list items (ShortText), long texts (LongText), and version notes (Note). */
export const MAX_SHORT = 200
export const MAX_LONG = 5000
export const MAX_NOTE = 2000
/** Most terms or phrases in one code check. */
export const MAX_LIST = 100

/** A date as yyyy-mm-dd in the local time zone, some days from today, for a date field. */
export function dateFromToday(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

/** One term or phrase per line: trimmed, no empty lines, each once. */
export function splitLines(text: string) {
  return [...new Set(text.split('\n').map((x) => x.trim()).filter(Boolean))]
}

/** A citation link starts with http:// or https://, up to 500 characters (the server checks the same). */
export const MAX_URL = 500
export const isWebUrl = (url: string) => /^https?:\/\//.test(url.trim())

/** After a Save with problems, move focus to the first field marked invalid, so keyboard users land on it. */
export function focusFirstInvalid(form: HTMLFormElement) {
  // Wait one frame: the fields get aria-invalid when the form renders again.
  requestAnimationFrame(() => {
    const field = form.querySelector<HTMLElement>('[aria-invalid="true"]')
    const target = field?.matches('[role="group"]') ? field.querySelector<HTMLElement>('button') : field
    target?.focus()
  })
}
