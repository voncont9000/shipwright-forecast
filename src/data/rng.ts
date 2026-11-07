/** Small seeded PRNG (mulberry32) plus helpers. No Math.random anywhere in the project. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash, for deriving sub-seeds from labels. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [a, b). */
  range(a: number, b: number): number
  /** Uniform integer in [a, b] inclusive. */
  int(a: number, b: number): number
  /** Normal via Box-Muller. */
  normal(mu?: number, sd?: number): number
  /** exp(normal(mu, sd)). */
  logNormal(mu: number, sd: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  weighted<T>(items: readonly T[], weights: readonly number[]): T
  shuffle<T>(items: readonly T[]): T[]
  poisson(lambda: number): number
  /** Independent child stream derived from this one's seed and a label. */
  fork(label: string | number): Rng
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed)
  const rng: Rng = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    normal: (mu = 0, sd = 1) => {
      let u = 0
      while (u === 0) u = next()
      const v = next()
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    logNormal: (mu, sd) => Math.exp(rng.normal(mu, sd)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items, weights) => {
      let total = 0
      for (const w of weights) total += w
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i]
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    },
    shuffle: (items) => {
      const a = items.slice()
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const t = a[i]
        a[i] = a[j]
        a[j] = t
      }
      return a
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0
      if (lambda > 40) return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))))
      const l = Math.exp(-lambda)
      let k = 0
      let p = 1
      do {
        k++
        p *= next()
      } while (p > l)
      return k - 1
    },
    fork: (label) => createRng((seed ^ hashString(String(label))) >>> 0),
  }
  return rng
}
