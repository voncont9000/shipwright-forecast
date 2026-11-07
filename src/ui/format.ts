/** Formatting helpers. All money in whole dollars. */

export const MINUS = '−'

/** $8.6M / $1.20M / $840k / $950. Under $2M uses two decimals so $1.20M and $1.27M stay distinct. */
export function money(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? MINUS : ''
  if (a >= 2_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}k`
  return `${sign}$${Math.round(a)}`
}

/** Two-decimal millions, for when one decimal hides a real difference ($8.65M). */
export function moneyPrecise(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${v < 0 ? MINUS : ''}$${(a / 1_000_000).toFixed(2)}M`
  return money(v)
}

/** +$28k / −$1.8M. Near-zero renders as the `zero` text (default "same"). */
export function signedMoney(v: number, zero = 'same'): string {
  if (Math.abs(v) < 500) return zero
  return `${v > 0 ? '+' : MINUS}${money(Math.abs(v))}`
}

/** 0.86 -> 86% */
export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`
}

/** 0.034 -> +3.4% */
export function signedPct(v: number, digits = 0): string {
  const s = (Math.abs(v) * 100).toFixed(digits)
  if (Number(s) === 0) return 'flat'
  return `${v > 0 ? '+' : MINUS}${s}%`
}

/** Coverage ratio: 3.0x */
export function times(v: number): string {
  return `${v.toFixed(1)}×`
}

/** 'YYYY-MM-DD' -> 'Dec 12' (no timezone surprises). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${d}`
}

export function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

/** Position of a value within a total, clamped, as a CSS percentage string. */
export function cssPct(value: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.min(100, Math.max(0, (value / total) * 100)).toFixed(2)}%`
}

/** Always millions with one decimal: $8.6M, $1.8M. Used where a screen compares figures in the same unit. */
export function millions(v: number, digits = 1): string {
  return `${v < 0 ? MINUS : ''}$${(Math.abs(v) / 1_000_000).toFixed(digits)}M`
}

export function signedMillions(v: number): string {
  return `${v < 0 ? MINUS : '+'}$${(Math.abs(v) / 1_000_000).toFixed(1)}M`
}

/** Round up to a tidy axis end. */
export function niceMax(v: number, step: number): number {
  return Math.ceil(v / step) * step
}
