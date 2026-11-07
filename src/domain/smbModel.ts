import type { Dataset } from './types'
import { currentQuarterIndex, snapshotAt } from './org'
import type { Rng } from '../data/rng'

/**
 * SMB run-rate / cohort model.
 *
 * Self-serve ARR still to come = trials per week (trailing run-rate, with learned growth)
 *   x conversion rate (this quarter so far, blended with history) x ARPA (this quarter so far),
 * simulated with trial-volume, conversion and ARPA uncertainty plus Poisson noise.
 * Sales-assisted deals, flagged churn, unflagged churn and the not-yet-created pipeline
 * are handled by the deal model (see dealModel.ts), tuned for SMB's short cycles and small deals.
 * Expansion: credit-usage candidates tilt the expansion run-rate (see candidateTilt).
 */

export interface SelfServeComponent {
  closed: number
  mean: number
  /** Draw the self-serve ARR still to come. */
  drawRemaining(rng: Rng, z: number): number
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

export function buildSelfServe(ds: Dataset, qi: number, week: number): SelfServeComponent {
  const q = ds.quarters[qi]
  const snap = snapshotAt(q, week)
  const f = snap.smbFunnel
  const remaining = 13 - week
  if (remaining <= 0) return { closed: f.selfServeArr, mean: f.selfServeArr, drawRemaining: () => 0 }

  // history from other closed quarters
  const hist = ds.quarters.filter((x, i) => !x.isCurrent && i !== qi)
  const histConv: number[] = []
  const growth: number[] = []
  for (const h of hist) {
    const last = h.snapshots[12].smbFunnel
    histConv.push(last.paidConversions / last.trialsStarted)
    const t = (i: number) => h.snapshots[i].smbFunnel.trialsStarted
    const early = (t(5) - t(2)) / 3
    const late = (t(12) - t(9)) / 3
    if (early > 0 && late > 0) growth.push(Math.pow(late / early, 1 / 7) - 1)
  }
  const g = Math.min(0.03, Math.max(-0.03, avg(growth)))
  const convHist = avg(histConv) || 0.034
  const convSd = histConv.length > 1
    ? Math.sqrt(histConv.reduce((a, b) => a + (b - convHist) ** 2, 0) / (histConv.length - 1)) / convHist
    : 0.08
  const convQtd = f.trialsStarted > 0 ? f.paidConversions / f.trialsStarted : convHist
  const conv = 0.6 * convQtd + 0.4 * convHist
  const arpa = f.paidConversions > 0 ? f.selfServeArr / f.paidConversions : 950
  const trailing = week >= 4 ? (f.trialsStarted - q.snapshots[week - 4].smbFunnel.trialsStarted) / 3 : f.trialsStarted / week
  let trials = 0
  for (let k = 1; k <= remaining; k++) trials += trailing * Math.pow(1 + g, k)
  const meanRemaining = trials * conv * arpa
  const sdConv = Math.max(0.06, convSd)
  return {
    closed: f.selfServeArr,
    mean: f.selfServeArr + meanRemaining,
    drawRemaining(rng, z) {
      const t = trials * Math.exp(rng.normal(0, 0.05 * Math.sqrt(remaining / 7)) + 0.03 * z)
      const c = conv * Math.exp(sdConv * (0.6 * z + 0.8 * rng.normal()) - 0.5 * sdConv * sdConv)
      const a = arpa * Math.exp(rng.normal(0, 0.03))
      const mean = t * c
      const count = Math.max(0, rng.normal(mean, Math.sqrt(mean)))
      return count * a
    },
  }
}

/**
 * Credit-usage tilt on the expansion run-rate: accounts above 80% of included credits in at
 * least 2 of the last 3 months are expansion candidates. More candidates than the typical 25% share
 * lifts expected expansion (capped); fewer lowers it. Only meaningful for the current quarter, where
 * usage data exists; closed quarters use a neutral 1.
 */
export const BASELINE_CANDIDATE_SHARE = 0.25

export function isExpansionCandidate(util: number[]): boolean {
  return util.slice(-3).filter((u) => u > 0.8).length >= 2
}

export function candidateTilt(ds: Dataset, qi: number, repIds: readonly string[]): number {
  if (qi !== currentQuarterIndex(ds)) return 1
  const ids = new Set(repIds)
  const mine = ds.accounts.filter((a) => ids.has(a.ownerId))
  if (mine.length < 5) return 1
  const share = mine.filter((a) => isExpansionCandidate(a.creditUtilisation)).length / mine.length
  return Math.min(1.25, Math.max(0.8, 1 + (0.5 * (share - BASELINE_CANDIDATE_SHARE)) / BASELINE_CANDIDATE_SHARE))
}
