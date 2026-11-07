import type { Dataset, ModelRange } from './types'
import { allReps, currentQuarterIndex, personById, repIdsUnder, smbReps } from './org'
import { closedNetForReps } from './prefill'
import { buildDealComponent, learnRates } from './dealModel'
import { buildSelfServe, candidateTilt } from './smbModel'
import { createRng, hashString } from '../data/rng'

/**
 * The statistical forecast ("model") for any set of reps: closed ARR + simulated outcomes of every
 * open deal + flagged churn + pipeline not yet created + self-serve run-rate (SMB) + unflagged churn.
 * Monte Carlo with a seeded RNG, so a given view always shows the same range.
 */
export const SIMULATIONS = 800

const cache = new WeakMap<Dataset, Map<string, ModelRange>>()

export function percentiles(sorted: number[]): ModelRange {
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]
  return { p10: Math.round(at(0.1)), p25: Math.round(at(0.25)), p50: Math.round(at(0.5)), p75: Math.round(at(0.75)), p90: Math.round(at(0.9)) }
}

export interface ModelOptions {
  /** Learn rates without this quarter (default: leave the quarter out when it is a closed one). */
  excludeSelf?: boolean
}

export function modelForReps(ds: Dataset, qi: number, week: number, repIds: readonly string[], opts: ModelOptions = {}): ModelRange {
  const q = ds.quarters[qi]
  const w = Math.min(Math.max(1, week), q.weeksElapsed)
  const sorted = repIds.slice().sort()
  const excl = opts.excludeSelf ?? !q.isCurrent
  const key = `${qi}|${w}|${excl ? 1 : 0}|${sorted.join(',')}`
  let perDs = cache.get(ds)
  if (!perDs) {
    perDs = new Map()
    cache.set(ds, perDs)
  }
  const hit = perDs.get(key)
  if (hit) return hit

  const rates = learnRates(ds, w, excl ? qi : null)
  const closed = closedNetForReps(ds, qi, w, sorted)
  const tilt = candidateTilt(ds, qi, sorted)
  const comp = buildDealComponent(ds, qi, w, sorted, rates, closed, tilt)
  const smbTotal = smbReps(ds).length
  const smbInScope = sorted.filter((id) => personById(ds, id).segment === 'SMB').length
  const ss = smbInScope > 0 ? buildSelfServe(ds, qi, w) : null
  const ssShare = smbTotal > 0 ? smbInScope / smbTotal : 0

  const rng = createRng((ds.seed * 7919 + hashString(key)) >>> 0)
  const sims: number[] = new Array(SIMULATIONS)
  for (let i = 0; i < SIMULATIONS; i++) {
    const z = rng.normal()
    let total = comp.draw(rng, z)
    if (ss) total += ssShare * ss.drawRemaining(rng, z)
    sims[i] = total
  }
  sims.sort((a, b) => a - b)
  const out = percentiles(sims)
  perDs.set(key, out)
  return out
}

/** Model for a person's whole book (a rep, or everyone below a manager / director / the CRO). */
export function modelForPerson(ds: Dataset, qi: number, week: number, personId: string, opts: ModelOptions = {}): ModelRange {
  return modelForReps(ds, qi, week, repIdsUnder(ds, personId), opts)
}

export function modelForSegment(ds: Dataset, qi: number, week: number, segment: 'SMB' | 'MM' | 'ENT', opts: ModelOptions = {}): ModelRange {
  const ids = allReps(ds).filter((r) => r.segment === segment).map((r) => r.id)
  return modelForReps(ds, qi, week, ids, opts)
}

export function modelForCompany(ds: Dataset, qi: number, week: number, opts: ModelOptions = {}): ModelRange {
  return modelForReps(ds, qi, week, allReps(ds).map((r) => r.id), opts)
}

export { currentQuarterIndex }
