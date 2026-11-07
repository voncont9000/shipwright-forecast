/** Tiny ISO-date helpers (UTC, no timezone surprises). */
const DAY = 86_400_000

export function toMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * DAY)
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY)
}
