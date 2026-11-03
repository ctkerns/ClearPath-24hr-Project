import { parseDay } from '@/i18n/format'

// The workspace calendar, the same as the server's (backend/src/app/clock.py). Business dates are days in the
// workspace's time zone (Settings > Workspace): approval expiry, effective dates, issue due days, review deadline
// days, the export range. So "today", "days left" and "overdue" are the same for every viewer, wherever they are.
// Days are "yyyy-mm-dd" strings. Timestamps (submitted at, history) still show in the viewer's own time zone.

let zone: string | undefined

/** The _app layout sets it from the session (GET /api/auth/me), and the Workspace tab after a save. */
export function setWorkspaceTimeZone(timeZone: string) {
  zone = timeZone
}

/** The workspace's IANA time zone. Before the session loads (the sign-in pages), the browser's own. */
export function workspaceTimeZone() {
  return zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Every IANA time zone the browser knows, for the picker. */
export function timeZoneNames(): string[] {
  return Intl.supportedValuesOf('timeZone')
}

const dayFormats = new Map<string, Intl.DateTimeFormat>()

function dayFormat(timeZone: string) {
  let f = dayFormats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayFormats.set(timeZone, f)
  }
  return f
}

/** The day ("yyyy-mm-dd") at a time, in the workspace's time zone. */
export function dayAt(time: Date | string | number, timeZone = workspaceTimeZone()) {
  const parts = dayFormat(timeZone).formatToParts(new Date(time))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Today in the workspace's time zone. */
export const today = () => dayAt(Date.now())

/** The day some days after (or before, when negative) a day. */
export function addDays(day: string, days: number) {
  const d = parseDay(day)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole calendar days from one day to another: 1 from today to tomorrow. */
export function daysBetween(from: string, to: string) {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000)
}

/** A day some days from today, in the workspace's time zone, for a date field. */
export const dayFromToday = (days: number) => addDays(today(), days)

/** 0 is Sunday, 6 is Saturday. */
export const weekday = (day: string) => parseDay(day).getUTCDay()

/** The day a deadline (an issue due time, a review deadline) falls on. A deadline at exactly midnight is the
 * end of the day before, like the server (backend/src/app/business_days.py due_day). */
export const dueDay = (deadline: string) => dayAt(Date.parse(deadline) - 1)

/** Minutes the time zone is ahead of UTC at a time: -480 for California in winter. */
function offsetMinutes(timeZone: string, time: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(time)
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((wall - Math.floor(time / 1000) * 1000) / 60_000)
}

/** Midnight at the start of the day in the workspace's time zone, as a time (ms). */
export function dayStart(day: string, timeZone = workspaceTimeZone()) {
  const wall = parseDay(day).getTime()
  const guess = wall - offsetMinutes(timeZone, wall) * 60_000
  return wall - offsetMinutes(timeZone, guess) * 60_000 // again with the offset at that time, for a daylight saving day
}

/** The end of the day in the workspace's time zone: midnight at the start of the next day, like the server (clock.day_end). */
export const dayEnd = (day: string, timeZone = workspaceTimeZone()) => dayStart(addDays(day, 1), timeZone)
