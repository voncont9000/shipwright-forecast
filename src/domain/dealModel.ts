import type { Dataset, Deal, Segment, Stage } from './types'
import { SEGMENTS } from './types'
import { diffDays } from './dates'
import { personById, quotaFor, snapshotAt } from './org'
import type { Rng } from '../data/rng'

/**
 * Deal-level model ("system forecast").
 *
 * 1. Stage win rates are re-learned from closed quarters: of the deals open at a given stage
 *    around the same week of the quarter, what share ended Closed Won inside the quarter?
 *    Cells with few deals borrow strength from the all-segment rate (shrinkage).
 * 2. Each deal's probability = learned stage rate x adjustments for age, close-date pushes,
 *    recency of activity and deal-quality score. The adjustments are normalised per cell so the
 *    average prediction still equals the observed rate (the adjustments re-rank deals; they do not
 *    move the level).
 * 3. Beyond today's deals, the model adds pipeline not yet created (run-rate learned from history,
 *    scaled to the person's quota) and unflagged churn, then simulates all of it (Monte Carlo).
 */

export interface RunRate {
  /** Mean of (ARR won from deals created after this week / segment plan) across training quarters. */
  mean: number
  /** Relative standard deviation across training quarters (floored). */
  relSd: number
}

export interface RateTable {
  week: number
  trainingQuarters: number[]
  /** Base (adjustment-normalised) win probability for a cell. */
  base(segment: Segment, stage: Stage, inQuarter: boolean): number
  /** Observed (un-normalised) win rate and sample size, for display and tests. */
  observed(segment: Segment, stage: Stage, inQuarter: boolean): { rate: number; n: number }
  cycleDays: Record<Segment, number>
  futureNew: Record<Segment, RunRate>
  futureExpansion: Record<Segment, RunRate>
  /** ARR of deals created so far this quarter, as a share of plan, averaged over training quarters (pipeline-creation pace). */
  createdPace: Record<Segment, number>
  /** Churn that arrives without having been flagged beforehand, as a share of segment plan. */
  unflaggedChurn: Record<Segment, RunRate>
}

const SHRINK = 12

// ── Adjustments ──────────────────────────────────────────────────────────────

export interface AdjustContext {
  asOf: string
  cycleDays: Record<Segment, number>
}

export function ageFactor(deal: Deal, ctx: AdjustContext): number {
  const age = diffDays(deal.createdDate, ctx.asOf)
  const ratio = age / ctx.cycleDays[deal.segment]
  return ratio > 1.6 ? 0.78 : ratio > 1.2 ? 0.9 : 1
}
export function pushFactor(pushes: number): number {
  return [1, 0.9, 0.7, 0.5][Math.min(3, pushes)]
}
export function activityFactor(deal: Deal, asOf: string): number {
  const gap = diffDays(deal.lastActivityDate, asOf)
  return gap <= 7 ? 1.05 : gap <= 14 ? 1 : gap <= 30 ? 0.8 : 0.55
}
export function qualityFactor(q: number): number {
  return 0.6 + (0.8 * q) / 100
}
export function adjustment(deal: Deal, ctx: AdjustContext): number {
  return ageFactor(deal, ctx) * pushFactor(deal.closeDatePushes) * activityFactor(deal, ctx.asOf) * qualityFactor(deal.qualityScore)
}

// ── Learning ─────────────────────────────────────────────────────────────────

const cellKey = (s: Segment | '*', stage: Stage, inQ: boolean) => `${s}|${stage}|${inQ ? 1 : 0}`

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const a = xs.slice().sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}

function runRate(samples: number[], floorRel = 0.25): RunRate {
  if (samples.length === 0) return { mean: 0, relSd: floorRel }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const v = samples.length > 1 ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1) : 0
  return { mean, relSd: Math.max(floorRel, mean > 0 ? Math.sqrt(v) / mean : floorRel) }
}

const rateCache = new WeakMap<Dataset, Map<string, RateTable>>()

/**
 * Re-learn stage win rates (and run-rates) from closed quarters as of a week of quarter.
 * `excludeQuarter` leaves one quarter out (used when back-testing a closed quarter honestly).
 */
export function learnRates(ds: Dataset, week: number, excludeQuarter: number | null = null): RateTable {
  let perDs = rateCache.get(ds)
  if (!perDs) {
    perDs = new Map()
    rateCache.set(ds, perDs)
  }
  const k = `${week}|${excludeQuarter ?? '-'}`
  const hit = perDs.get(k)
  if (hit) return hit

  const train: number[] = []
  ds.quarters.forEach((q, i) => {
    if (!q.isCurrent && i !== excludeQuarter) train.push(i)
  })

  // cycle length per segment from won deals
  const cycleDays = {} as Record<Segment, number>
  for (const seg of SEGMENTS) {
    const cycles: number[] = []
    for (const qi of train) {
      const final = ds.quarters[qi].snapshots[12]
      for (const d of final.deals) if (d.segment === seg && d.stage === 'Closed Won') cycles.push(diffDays(d.createdDate, d.closeDate))
    }
    cycleDays[seg] = Math.max(7, median(cycles))
  }

  const n = new Map<string, number>()
  const won = new Map<string, number>()
  const adj = new Map<string, number>()
  const bump = (m: Map<string, number>, key: string, v: number) => m.set(key, (m.get(key) ?? 0) + v)
  const weeks = [week - 1, week, week + 1].filter((w) => w >= 1 && w <= 13)
  for (const qi of train) {
    const q = ds.quarters[qi]
    const finalWon = new Set(q.snapshots[12].deals.filter((d) => d.stage === 'Closed Won').map((d) => d.id))
    for (const w of weeks) {
      const snap = q.snapshots[w - 1]
      const ctx: AdjustContext = { asOf: snap.asOf, cycleDays }
      for (const d of snap.deals) {
        if (d.stage === 'Closed Won' || d.stage === 'Closed Lost') continue
        const inQ = d.closeDate <= q.end && d.closeDate >= q.start
        const a = adjustment(d, ctx)
        const w1 = finalWon.has(d.id) ? 1 : 0
        for (const key of [cellKey(d.segment, d.stage, inQ), cellKey('*', d.stage, inQ)]) {
          bump(n, key, 1)
          bump(won, key, w1)
          bump(adj, key, a)
        }
      }
    }
  }

  const baseCache = new Map<string, number>()
  const obsCache = new Map<string, { rate: number; n: number }>()
  const parentObs = (stage: Stage, inQ: boolean) => {
    const key = cellKey('*', stage, inQ)
    const nn = n.get(key) ?? 0
    return nn > 0 ? (won.get(key) ?? 0) / nn : inQ ? 0.2 : 0.02
  }
  const parentAdj = (stage: Stage, inQ: boolean) => {
    const key = cellKey('*', stage, inQ)
    const nn = n.get(key) ?? 0
    return nn > 0 ? (adj.get(key) ?? 0) / nn : 1
  }
  const observed = (seg: Segment, stage: Stage, inQ: boolean) => {
    const key = cellKey(seg, stage, inQ)
    const cached = obsCache.get(key)
    if (cached) return cached
    const nn = n.get(key) ?? 0
    const parent = parentObs(stage, inQ)
    const rate = ((won.get(key) ?? 0) + SHRINK * parent) / (nn + SHRINK)
    const out = { rate, n: nn }
    obsCache.set(key, out)
    return out
  }
  const base = (seg: Segment, stage: Stage, inQ: boolean) => {
    const key = cellKey(seg, stage, inQ)
    const cached = baseCache.get(key)
    if (cached !== undefined) return cached
    const nn = n.get(key) ?? 0
    const meanAdj = (((adj.get(key) ?? 0) + SHRINK * parentAdj(stage, inQ)) / (nn + SHRINK)) || 1
    const v = observed(seg, stage, inQ).rate / meanAdj
    baseCache.set(key, v)
    return v
  }

  // run-rates: ARR won from deals created after this week, and unflagged churn, relative to segment plan
  const futureNew = {} as Record<Segment, RunRate>
  const futureExpansion = {} as Record<Segment, RunRate>
  const unflaggedChurn = {} as Record<Segment, RunRate>
  const createdPace = {} as Record<Segment, number>
  for (const seg of SEGMENTS) {
    const pace: number[] = []
    const fn: number[] = []
    const fe: number[] = []
    const uc: number[] = []
    for (const qi of train) {
      const q = ds.quarters[qi]
      const asOf = q.snapshots[week - 1].asOf
      let nw = 0
      let ex = 0
      for (const d of q.snapshots[12].deals) {
        if (d.segment !== seg || d.stage !== 'Closed Won' || d.createdDate <= asOf) continue
        if (d.type === 'New') nw += d.amount
        else ex += d.amount
      }
      const seen = new Set(q.snapshots[week - 1].churn.map((c) => `${c.accountId}|${c.kind}`))
      let ch = 0
      for (const c of q.snapshots[12].churn) if (c.segment === seg && c.realised && !seen.has(`${c.accountId}|${c.kind}`)) ch += c.arrAtRisk
      let created = 0
      for (const d of q.snapshots[week - 1].deals) if (d.segment === seg && d.createdDate >= q.start) created += d.amount
      pace.push(created / q.plan[seg])
      fn.push(nw / q.plan[seg])
      fe.push(ex / q.plan[seg])
      uc.push(ch / q.plan[seg])
    }
    futureNew[seg] = runRate(fn)
    futureExpansion[seg] = runRate(fe)
    unflaggedChurn[seg] = runRate(uc, 0.4)
    createdPace[seg] = pace.length ? pace.reduce((a, b) => a + b, 0) / pace.length : 1
  }

  const table: RateTable = {
    week, trainingQuarters: train, base, observed, cycleDays, futureNew, futureExpansion, createdPace, unflaggedChurn,
  }
  perDs.set(k, table)
  return table
}

// ── Per-deal probability ─────────────────────────────────────────────────────

export function dealWinProbability(deal: Deal, quarterStart: string, quarterEnd: string, asOf: string, rates: RateTable): number {
  if (deal.stage === 'Closed Won') return 1
  if (deal.stage === 'Closed Lost') return 0
  const inQ = deal.closeDate <= quarterEnd && deal.closeDate >= quarterStart
  const p = rates.base(deal.segment, deal.stage, inQ) * adjustment(deal, { asOf, cycleDays: rates.cycleDays })
  return Math.min(0.98, Math.max(0.003, p))
}

// ── Monte Carlo component ────────────────────────────────────────────────────

export interface DealComponent {
  /** Net ARR already closed. */
  closed: number
  /** Expected total, for display. */
  mean: number
  draw(rng: Rng, z: number): number
}

/** Standard-normal -> logit shift on every win probability: models "the whole book runs hot/cold together". */
export const WIN_SHOCK_SD = 0.3
export const RUN_RATE_COMMON_SD = 0.12
/** How far the model leans on this quarter's pipeline-creation pace vs history (0 = ignore, 1 = fully). */
export const PACE_WEIGHT = 0.6

export function buildDealComponent(
  ds: Dataset, qi: number, week: number, repIds: readonly string[], rates: RateTable,
  closed: number, expansionTilt = 1,
): DealComponent {
  const q = ds.quarters[qi]
  const snap = snapshotAt(q, week)
  const ids = new Set(repIds)
  const amounts: number[] = []
  const logits: number[] = []
  let meanDeals = 0
  for (const d of snap.deals) {
    if (!ids.has(d.ownerId) || d.stage === 'Closed Won' || d.stage === 'Closed Lost') continue
    const p = dealWinProbability(d, q.start, q.end, snap.asOf, rates)
    amounts.push(d.amount)
    logits.push(Math.log(p / (1 - p)))
    meanDeals += p * d.amount
  }
  const churnArr: number[] = []
  const churnP: number[] = []
  let meanChurn = 0
  for (const c of snap.churn) {
    if (!ids.has(c.ownerId) || c.realised) continue
    churnArr.push(c.arrAtRisk)
    churnP.push(c.probability)
    meanChurn += c.arrAtRisk * c.probability
  }
  // future pipeline + unflagged churn, per rep
  const reps = repIds.map((id) => personById(ds, id))
  const futNew: number[] = []
  const futExp: number[] = []
  const futChurn: number[] = []
  const futSd: number[] = []
  const expSd: number[] = []
  const chSd: number[] = []
  let meanFuture = 0
  for (const r of reps) {
    const seg = r.segment as Segment
    const quota = quotaFor(ds, qi, r)
    let created = 0
    for (const d of snap.deals) if (d.ownerId === r.id && d.createdDate >= q.start) created += d.amount
    const pace = rates.createdPace[seg] > 0 && quota > 0 ? created / quota / rates.createdPace[seg] : 1
    const paceFactor = Math.min(1.6, Math.max(0.4, 1 + PACE_WEIGHT * (pace - 1)))
    const n = rates.futureNew[seg].mean * quota * paceFactor
    const e = rates.futureExpansion[seg].mean * quota * expansionTilt * paceFactor
    const c = rates.unflaggedChurn[seg].mean * quota
    futNew.push(n)
    futExp.push(e)
    futChurn.push(c)
    futSd.push(Math.max(0.35, rates.futureNew[seg].relSd))
    expSd.push(Math.max(0.35, rates.futureExpansion[seg].relSd))
    chSd.push(Math.max(0.45, rates.unflaggedChurn[seg].relSd))
    meanFuture += n + e - c
  }
  const nDeals = amounts.length
  const logn = (rng: Rng, sd: number) => Math.exp(rng.normal(-0.5 * sd * sd, sd))
  return {
    closed,
    mean: closed + meanDeals - meanChurn + meanFuture,
    draw(rng, z) {
      let total = closed
      const shift = WIN_SHOCK_SD * z
      for (let i = 0; i < nDeals; i++) {
        const p = 1 / (1 + Math.exp(-(logits[i] + shift)))
        if (rng.next() < p) total += amounts[i]
      }
      for (let i = 0; i < churnArr.length; i++) if (rng.next() < churnP[i]) total -= churnArr[i]
      const common = Math.exp(RUN_RATE_COMMON_SD * z - 0.5 * RUN_RATE_COMMON_SD ** 2)
      for (let i = 0; i < futNew.length; i++) {
        total += futNew[i] * common * logn(rng, futSd[i]) + futExp[i] * common * logn(rng, expSd[i]) - futChurn[i] * logn(rng, chSd[i])
      }
      return total
    },
  }
}
