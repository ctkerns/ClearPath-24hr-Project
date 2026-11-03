import i18n from './index'

// Format numbers, money and dates for the current language with the browser's Intl API.
// Never build these strings by hand (for example `${n}%` or toLocaleDateString() with no locale).

const locale = () => i18n.language

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale(), options).format(value)
}

/** `value` is a fraction: 0.875 → "87.5%". */
export function formatPercent(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits }).format(value)
}

export function formatCurrency(value: number, currency = 'USD') {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(value)
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a calendar day without a time, like "2027-02-01": an expiry or effective date (a Postgres `date`). */
export const isDay = (value: unknown): value is string => typeof value === 'string' && DAY.test(value)

/**
 * A calendar day "2027-02-01" as a Date at midnight UTC, for formatting and day arithmetic in UTC.
 * Every date-only value goes through here. `new Date("2027-02-01")` is midnight UTC too, but formatted in the
 * viewer's time zone it shows Jan 31 west of UTC, so a day is always formatted with timeZone: 'UTC'.
 */
export function parseDay(day: string) {
  const [, y, m, d] = DAY.exec(day) ?? []
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
}

/** A day ("2027-02-01") shows as that day for every viewer; a time shows in the viewer's own time zone. */
export function formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  if (isDay(value)) return new Intl.DateTimeFormat(locale(), { ...options, timeZone: 'UTC' }).format(parseDay(value))
  return new Intl.DateTimeFormat(locale(), options).format(new Date(value))
}

/** The UTC offset of a time zone now, like "GMT-08:00", for the time zone picker. */
export function formatTimeZoneOffset(timeZone: string, at: number = Date.now()) {
  const parts = new Intl.DateTimeFormat(locale(), { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

export function formatDateTime(value: Date | string | number) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "5 minutes ago", "yesterday", "3 days ago": for recent events such as notifications. */
export function formatRelativeTime(value: Date | string | number, now: number = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity],
  ]
  let amount = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(amount) < size) return rtf.format(Math.round(amount), unit)
    amount /= size
  }
  return rtf.format(Math.round(amount), 'year')
}
