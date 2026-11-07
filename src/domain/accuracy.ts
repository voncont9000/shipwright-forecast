import type { AccuracyView, BiasStat, CalibrationRow, ChainStep, Dataset, Person, PersonAccuracy, Segment } from './types'
import { SEGMENTS } from './types'
import { seedCallFor } from './rollup'
import { modelForSegment } from './model'

/** Past-quarter accuracy: actual / call by week of quarter, bias, MAPE, slip and push rates. */

/** Minimum closed quarters before a person gets a bias figure. */
export const MIN_QUARTERS_FOR_BIAS = 2

export function closedQuarterIndexes(ds: Dataset): number[] {
  const out: number[] = []
  ds.quarters.forEach((q, i) => {
    if (!q.isCurrent && q.actuals) out.push(i)
  })
  return out
}

/** Mean of actual / call over (call, actual) pairs, skipping calls <= 0. */
export function meanRatio(pairs: readonly { call: number; actual: number }[]): number {
  // A tiny or negative actual says nothing about forecasting skill, so it is skipped.
  const usable = pairs.filter((p) => p.call > 0 && p.actual >= 0.1 * p.call)
  if (usable.length === 0) return NaN
  return usable.reduce((a, p) => a + p.actual / p.call, 0) / usable.length
}

export function personBias(ds: Dataset, personId: string, week: number): BiasStat | null {
  const commit: { call: number; actual: number }[] = []
  const ml: { call: number; actual: number }[] = []
  for (const qi of closedQuarterIndexes(ds)) {
    const call = seedCallFor(ds, qi, week, personId)
    const actual = ds.quarters[qi].actuals!.byPerson[personId]
    if (!call || actual === undefined) continue
    commit.push({ call: call.commit, actual })
    ml.push({ call: call.mostLikely, actual })
  }
  const used = commit.filter((p) => p.call > 0 && p.actual >= 0.1 * p.call).length
  if (used < MIN_QUARTERS_FOR_BIAS) return null
  return { commitRatio: meanRatio(commit), mostLikelyRatio: meanRatio(ml), quartersUsed: used }
}

/** Mean absolute % error of the most-likely call at a week, over closed quarters. */
export function personMape(ds: Dataset, personId: string, week = 6): number {
  const errs: number[] = []
  for (const qi of closedQuarterIndexes(ds)) {
    const call = seedCallFor(ds, qi, week, personId)
    const actual = ds.quarters[qi].actuals!.byPerson[personId]
    if (!call || actual === undefined || actual < 50_000) continue
    errs.push(Math.abs(call.mostLikely - actual) / Math.abs(actual))
  }
  return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN
}

const LEVEL_ROLE: Record<ChainStep['level'], Person['role']> = { Reps: 'rep', Managers: 'manager', Directors: 'director', CRO: 'cro' }

/** For each level, actual / most-likely by week of quarter, averaged over closed quarters. */
export function accuracyByWeek(ds: Dataset): AccuracyView['byWeek'] {
  const levels: ChainStep['level'][] = ['Reps', 'Managers', 'Directors', 'CRO']
  return levels.map((level) => {
    const people = ds.org.people.filter((p) => p.role === LEVEL_ROLE[level])
    const points: { week: number; ratio: number }[] = []
    for (let week = 1; week <= 13; week++) {
      const ratios: number[] = []
      for (const qi of closedQuarterIndexes(ds)) {
        let call = 0
        let actual = 0
        for (const p of people) {
          const c = seedCallFor(ds, qi, week, p.id)
          if (!c) continue
          call += c.mostLikely
          actual += ds.quarters[qi].actuals!.byPerson[p.id] ?? 0
        }
        if (call > 0) ratios.push(actual / call)
      }
      points.push({ week, ratio: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : NaN })
    }
    return { level, points }
  })
}

export interface DealFlowStats {
  slipRate: number
  pushRate: number
  commitConversion: number
}

/** Slip, push and commit-to-close stats from closed quarters, looking at the commit list as of `week`. */
export function dealFlowStats(ds: Dataset, week = 6): DealFlowStats {
  let commitCount = 0
  let slipped = 0
  let commitValue = 0
  let commitWon = 0
  let dealsTotal = 0
  let dealsPushed = 0
  for (const qi of closedQuarterIndexes(ds)) {
    const q = ds.quarters[qi]
    const final = new Map(q.snapshots[12].deals.map((d) => [d.id, d]))
    for (const d of q.snapshots[week - 1].deals) {
      if (d.category !== 'Commit' || d.stage === 'Closed Won' || d.stage === 'Closed Lost') continue
      if (d.closeDate > q.end || d.closeDate < q.start) continue
      commitCount++
      commitValue += d.amount
      const f = final.get(d.id)
      if (f?.stage === 'Closed Won') commitWon += d.amount
      else if (!f || f.stage !== 'Closed Lost') {
        if (f && f.closeDate > q.end) slipped++
      }
    }
    for (const d of q.snapshots[12].deals) {
      if (d.stage === 'Closed Lost') continue
      dealsTotal++
      if (d.closeDatePushes >= 1) dealsPushed++
    }
  }
  return {
    slipRate: commitCount ? slipped / commitCount : 0,
    pushRate: dealsTotal ? dealsPushed / dealsTotal : 0,
    commitConversion: commitValue ? commitWon / commitValue : 0,
  }
}

export function calibrationRows(ds: Dataset, segment: Segment, week = 6): CalibrationRow[] {
  return closedQuarterIndexes(ds).map((qi) => {
    const q = ds.quarters[qi]
    const model = modelForSegment(ds, qi, week, segment)
    const actual = q.actuals!.bySegment[segment]
    return { quarterLabel: q.label, actual, model, insideP10P90: actual >= model.p10 && actual <= model.p90 }
  })
}

export function buildAccuracyView(ds: Dataset): AccuracyView {
  const people: PersonAccuracy[] = []
  for (const p of ds.org.people) {
    const bias = personBias(ds, p.id, 6)
    if (!bias) continue
    people.push({ person: p, bias, mape: personMape(ds, p.id, 6) })
  }
  const flow = dealFlowStats(ds, 6)
  return {
    byWeek: accuracyByWeek(ds),
    people,
    calibration: SEGMENTS.map((segment) => ({ segment, rows: calibrationRows(ds, segment, 6) })),
    ...flow,
  }
}

/** CRO most-likely call at a week vs actual, per closed quarter: abs % error. */
export function croErrors(ds: Dataset, week: number): number[] {
  const out: number[] = []
  for (const qi of closedQuarterIndexes(ds)) {
    const c = seedCallFor(ds, qi, week, ds.org.croId)
    const a = ds.quarters[qi].actuals!.netNewArr
    if (c && a) out.push(Math.abs(c.mostLikely - a) / Math.abs(a))
  }
  return out
}
