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

export function formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  return new Intl.DateTimeFormat(locale(), options).format(new Date(value))
}

export function formatDateTime(value: Date | string | number) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}
