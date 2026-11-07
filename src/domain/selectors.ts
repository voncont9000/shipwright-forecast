import type { ForecastApi } from './api'
import type {
  AccuracyView, BoardView, Call, CallTriple, CroView, Coverage, Dataset, Deal, DealRow, Kpi, ModelRange, PersonRole,
  RepView, Segment, TeamRow, TeamView, TrendPoint, ViewInput, Week,
} from './types'
import { SEGMENTS } from './types'
import { generateDataset } from '../data/generator'
import { checkEligibility } from './eligibility'
import {
  allReps, childrenOf, clampWeek, currentQuarterIndex, eligibilityContext, personById, repIdsUnder, snapshotAt,
} from './org'
import { closedNetForReps, repPrefill, selfServeRunRate, selfServeShare } from './prefill'
import { effectiveCall, buildChain, rollupWeek, sumCalls } from './rollup'
import { dealWinProbability, learnRates } from './dealModel'
import { modelForCompany, modelForPerson, modelForReps, modelForSegment } from './model'
import { buildAccuracyView, croErrors, personBias } from './accuracy'
import { arrBridge, weekOverWeek } from './bridge'

export const DEADLINES: Record<PersonRole, string> = {
  rep: 'Monday 17:00',
  manager: 'Tuesday 17:00',
  director: 'Wednesday 17:00',
  cro: 'Thursday 12:00',
}

const COVERAGE_TARGET: Record<Segment, number> = { SMB: 3, MM: 3, ENT: 4 }

const datasets = new Map<number, Dataset>()
function load(seed = 42): Dataset {
  let ds = datasets.get(seed)
  if (!ds) {
    ds = generateDataset(seed)
    datasets.set(seed, ds)
  }
  return ds
}

const accuracyCache = new WeakMap<Dataset, AccuracyView>()

function ctxOf(ds: Dataset, input: ViewInput) {
  const qi = currentQuarterIndex(ds)
  const q = ds.quarters[qi]
  const week = clampWeek(q, input.week)
  return { qi, q, week }
}

// ── Shared pieces ────────────────────────────────────────────────────────────

const CATEGORY_ORDER: Record<string, number> = { Commit: 0, 'Best Case': 1, Pipeline: 2, 'Closed Won': 3, Omitted: 4 }

function isOpen(d: Deal): boolean {
  return d.stage !== 'Closed Won' && d.stage !== 'Closed Lost'
}

function dealRows(ds: Dataset, qi: number, week: number, repIds: readonly string[]): DealRow[] {
  const q = ds.quarters[qi]
  const snap = snapshotAt(q, week)
  const ids = new Set(repIds)
  const rates = learnRates(ds, week, q.isCurrent ? null : qi)
  const ctx = eligibilityContext(q, week)
  const rows: DealRow[] = []
  for (const d of snap.deals) {
    if (!ids.has(d.ownerId) || d.stage === 'Closed Lost') continue
    const inQ = d.closeDate >= q.start && d.closeDate <= q.end
    if (isOpen(d) && !inQ && d.category !== 'Commit' && d.category !== 'Best Case') continue
    const eligibility = checkEligibility(d, ctx)
    rows.push({
      deal: d,
      eligibility,
      commitAtRisk: d.category === 'Commit' && isOpen(d) && !eligibility.eligible,
      winProbability: dealWinProbability(d, q.start, q.end, snap.asOf, rates),
    })
  }
  rows.sort((a, b) => (CATEGORY_ORDER[a.deal.category] - CATEGORY_ORDER[b.deal.category]) || (b.deal.amount - a.deal.amount))
  return rows
}

function coverageFor(ds: Dataset, qi: number, week: number, repIds: readonly string[]): Coverage {
  const q = ds.quarters[qi]
  const snap = snapshotAt(q, week)
  const ids = new Set(repIds)
  let open = 0
  for (const d of snap.deals) {
    if (!ids.has(d.ownerId) || !isOpen(d) || d.closeDate < q.start || d.closeDate > q.end) continue
    if (d.category === 'Pipeline' || d.category === 'Best Case' || d.category === 'Commit') open += d.amount
  }
  let quota = 0
  let targetWeighted = 0
  for (const id of repIds) {
    const p = personById(ds, id)
    const share = selfServeShare(ds, id)
    if (share > 0) open += share * selfServeRunRate(q, week) * (13 - week)
    quota += p.quota
    targetWeighted += p.quota * COVERAGE_TARGET[p.segment as Segment]
  }
  const closed = closedNetForReps(ds, qi, week, repIds)
  const remaining = Math.max(0, quota - closed)
  return {
    openPipeline: Math.round(open),
    remaining: Math.round(remaining),
    ratio: remaining > 0 ? Math.round((open / remaining) * 100) / 100 : 0,
    target: quota > 0 ? Math.round((targetWeighted / quota) * 10) / 10 : 3,
  }
}

const asTriple = (c: CallTriple): CallTriple => ({ commit: c.commit, mostLikely: c.mostLikely, bestCase: c.bestCase })

function pct(x: number): number {
  return Math.round(x * 100)
}

/** Flag a commit outside the model's middle band (P25-P75, half of outcomes), the same band the screens draw. */
function warningFor(commit: number, m: ModelRange): string | null {
  if (m.p50 <= 0 || commit <= 0) return null
  if (commit >= m.p25 && commit <= m.p75) return null
  const diff = (commit - m.p50) / m.p50
  return `Commit ${pct(Math.abs(diff))}% ${diff > 0 ? 'above' : 'below'} model`
}

// ── Views ────────────────────────────────────────────────────────────────────

function repView(ds: Dataset, input: ViewInput, personId: string): RepView {
  const { qi, q, week } = ctxOf(ds, input)
  const person = personById(ds, personId)
  const roll = rollupWeek(ds, qi, week, input.userCalls).get(personId)
  const prefill = repPrefill(ds, qi, week, personId)
  return {
    person,
    quarterLabel: q.label,
    week,
    deadline: DEADLINES.rep,
    quota: person.quota,
    closed: Math.round(closedNetForReps(ds, qi, week, [personId])),
    prefill,
    submitted: roll?.effective ?? null,
    deals: dealRows(ds, qi, week, [personId]),
    model: modelForReps(ds, qi, week, [personId]),
    bias: personBias(ds, personId, week),
    coverage: coverageFor(ds, qi, week, [personId]),
  }
}

function teamView(ds: Dataset, input: ViewInput, personId: string): TeamView {
  const { qi, q, week } = ctxOf(ds, input)
  const person = personById(ds, personId)
  const roll = rollupWeek(ds, qi, week, input.userCalls)
  const kids = childrenOf(ds, personId)
  const rows: TeamRow[] = kids.map((k) => {
    const r = roll.get(k.id)
    const call = r ? asTriple(r.effective) : { commit: 0, mostLikely: 0, bestCase: 0 }
    const bias = personBias(ds, k.id, week)
    const model = modelForPerson(ds, qi, week, k.id)
    return {
      person: k,
      call,
      likelyToLand: bias ? Math.round(call.commit * bias.commitRatio) : null,
      biasNote: bias ? `lands at ${pct(bias.commitRatio)}% of commit on average` : null,
      model: model.p50,
      modelRange: model,
      warning: warningFor(call.commit, model),
      submitted: !!r,
    }
  })
  const reps = repIdsUnder(ds, personId)
  const mine = roll.get(personId)
  const reportsSum = mine?.reportsSum ?? sumCalls(rows.map((r) => r.call))
  const closed = closedNetForReps(ds, qi, week, reps)
  const prevSum = week > 1 ? (rollupWeek(ds, qi, week - 1, input.userCalls).get(personId)?.reportsSum ?? reportsSum) : reportsSum
  const atRisk = dealRows(ds, qi, week, reps).filter((r) => r.commitAtRisk).sort((a, b) => b.deal.amount - a.deal.amount)
  return {
    person,
    quarterLabel: q.label,
    week,
    deadline: DEADLINES[person.role as PersonRole],
    reportsLabel: person.role === 'manager' ? `${kids.length} reps` : `${kids.length} managers`,
    rows,
    reportsSum: asTriple(reportsSum),
    ownCall: mine?.effective ?? null,
    model: modelForPerson(ds, qi, week, personId),
    pathToPlan: {
      plan: person.quota,
      closed: Math.round(closed),
      committedOpen: Math.round(reportsSum.commit - closed),
      gap: Math.max(0, Math.round(person.quota - reportsSum.commit)),
      changeSinceLastWeek: Math.round(reportsSum.commit - prevSum.commit),
    },
    atRiskCommits: atRisk,
    coverage: coverageFor(ds, qi, week, reps),
  }
}

function croView(ds: Dataset, input: ViewInput): CroView {
  const { qi, q, week } = ctxOf(ds, input)
  const cro = personById(ds, ds.org.croId)
  const roll = rollupWeek(ds, qi, week, input.userCalls)
  const directors = ds.org.people.filter((p) => p.role === 'director')
  const segments = SEGMENTS.map((segment) => {
    const dir = directors.find((d) => d.segment === segment)!
    const r = roll.get(dir.id)
    const reps = repIdsUnder(ds, dir.id)
    return {
      segment,
      directorName: dir.name,
      plan: dir.quota,
      call: r ? asTriple(r.effective) : { commit: 0, mostLikely: 0, bestCase: 0 },
      model: modelForSegment(ds, qi, week, segment),
      closed: Math.round(closedNetForReps(ds, qi, week, reps)),
      coverage: coverageFor(ds, qi, week, reps),
    }
  })
  const mine = roll.get(cro.id)
  const prev = week > 1 ? effectiveCall(ds, qi, week - 1, cro.id, input.userCalls) : null
  const reps = allReps(ds).map((r) => r.id)
  return {
    person: cro,
    quarterLabel: q.label,
    week,
    deadline: DEADLINES.cro,
    segments,
    reportsSum: asTriple(mine?.reportsSum ?? sumCalls(segments.map((s) => s.call))),
    ownCall: mine?.effective ?? null,
    model: modelForCompany(ds, qi, week),
    plan: ds.org.boardPlan,
    chain: buildChain(ds, qi, week, input.userCalls),
    wow: {
      from: prev?.mostLikely ?? 0,
      to: mine?.effective.mostLikely ?? 0,
      changes: weekOverWeek(ds, qi, week - 1, week, reps),
    },
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function kpis(ds: Dataset, qi: number, week: number): Kpi[] {
  const q = ds.quarters[qi]
  const prevQ = qi > 0 ? ds.quarters[qi - 1] : null
  const closedQs = ds.quarters.filter((x) => !x.isCurrent && x.actuals)
  const start0 = closedQs[0]?.startingArr || 1
  const exp = sum(closedQs.map((x) => x.actuals!.expansionArr))
  const churn = sum(closedQs.map((x) => x.actuals!.churnArr))
  const nrr = 1 + (exp - churn) / start0
  const grr = 1 - churn / start0

  const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
  const utilNow = mean(ds.accounts.map((a) => mean(a.creditUtilisation.slice(3))))
  const utilBefore = mean(ds.accounts.map((a) => mean(a.creditUtilisation.slice(0, 3))))

  const repIds = allReps(ds).map((r) => r.id)
  const cov = coverageFor(ds, qi, week, repIds)
  const prevCov = prevQ ? coverageFor(ds, qi - 1, week, repIds) : null

  const winRate = (quarter: typeof q, upTo: number) => {
    let won = 0
    let lost = 0
    for (let w = 1; w <= upTo; w++) {
      const s = quarter.snapshots[w - 1]
      const prevIds = w > 1 ? new Set(quarter.snapshots[w - 2].deals.filter((d) => d.stage === 'Closed Won' || d.stage === 'Closed Lost').map((d) => d.id)) : new Set<string>()
      for (const d of s.deals) {
        if (prevIds.has(d.id)) continue
        if (d.stage === 'Closed Won') won++
        else if (d.stage === 'Closed Lost') lost++
      }
    }
    return won + lost > 0 ? won / (won + lost) : 0
  }
  const cycle = (quarter: typeof q, upTo: number) => {
    const days: number[] = []
    for (const d of quarter.snapshots[upTo - 1].deals) {
      if (d.stage === 'Closed Won') days.push((Date.parse(d.closeDate) - Date.parse(d.createdDate)) / 86_400_000)
    }
    return mean(days)
  }
  const conv = (quarter: typeof q, w: number) => {
    const f = quarter.snapshots[w - 1].smbFunnel
    return f.trialsStarted > 0 ? f.paidConversions / f.trialsStarted : 0
  }
  const r2 = (x: number) => Math.round(x * 1000) / 1000
  return [
    { id: 'nrr', label: 'Net revenue retention', value: r2(nrr), unit: '%', change: null },
    { id: 'grr', label: 'Gross revenue retention', value: r2(grr), unit: '%', change: null },
    { id: 'credit-utilisation', label: 'Credit utilisation', value: r2(utilNow), unit: '%', change: r2(utilNow - utilBefore) },
    { id: 'coverage', label: 'Pipeline coverage', value: cov.ratio, unit: 'x', change: prevCov ? Math.round((cov.ratio - prevCov.ratio) * 100) / 100 : null, target: cov.target },
    { id: 'win-rate', label: 'Win rate', value: r2(winRate(q, week)), unit: '%', change: prevQ ? r2(winRate(q, week) - winRate(prevQ, week)) : null },
    { id: 'cycle-days', label: 'Sales cycle', value: Math.round(cycle(q, week)), unit: 'days', change: prevQ ? Math.round(cycle(q, week) - cycle(prevQ, week)) : null },
    { id: 'self-serve-conversion', label: 'Self-serve conversion', value: r2(conv(q, week)), unit: '%', change: prevQ ? r2(conv(q, week) - conv(prevQ, week)) : null },
  ]
}

function boardView(ds: Dataset, input: ViewInput): BoardView {
  const { qi, q, week } = ctxOf(ds, input)
  const roll = rollupWeek(ds, qi, week, input.userCalls)
  const cro = roll.get(ds.org.croId)
  const trend: TrendPoint[] = []
  for (let w = 1; w <= 13; w++) {
    if (w > week) {
      trend.push({ week: w, call: null, model: null })
      continue
    }
    const c = effectiveCall(ds, qi, w, ds.org.croId, input.userCalls)
    trend.push({ week: w, call: c ? c.mostLikely : null, model: modelForCompany(ds, qi, w) })
  }
  const errs = croErrors(ds, week)
  const accuracyNote = errs.length
    ? `Over the last ${errs.length} quarters the week-${week} call landed within ${Math.max(1, Math.ceil(Math.max(...errs) * 100))}% of actual.`
    : ''
  const directors = ds.org.people.filter((p) => p.role === 'director')
  return {
    quarterLabel: q.label,
    week,
    call: cro ? asTriple(cro.effective) : { commit: 0, mostLikely: 0, bestCase: 0 },
    plan: ds.org.boardPlan,
    model: modelForCompany(ds, qi, week),
    accuracyNote,
    bridge: arrBridge(ds, qi, week, input.userCalls),
    trend,
    segments: SEGMENTS.map((segment) => {
      const dir = directors.find((d) => d.segment === segment)!
      return { segment, call: roll.get(dir.id)?.effective.mostLikely ?? 0, plan: dir.quota }
    }),
    kpis: kpis(ds, qi, week),
  }
}

function accuracyView(ds: Dataset): AccuracyView {
  let v = accuracyCache.get(ds)
  if (!v) {
    v = buildAccuracyView(ds)
    accuracyCache.set(ds, v)
  }
  return v
}

// ── Call validation ──────────────────────────────────────────────────────────

const OVERRIDE_TOLERANCE = 1

function prepareCall(
  ds: Dataset, input: ViewInput, personId: string,
  values: { commit: number; mostLikely: number; bestCase: number; reason?: string },
): { ok: true; call: Call } | { ok: false; error: string } {
  const { qi, q, week } = ctxOf(ds, input)
  const person = personById(ds, personId)
  const { commit, mostLikely, bestCase } = values
  if (![commit, mostLikely, bestCase].every((n) => Number.isFinite(n) && n >= 0)) {
    return { ok: false, error: 'Enter amounts of zero or more for Commit, Most likely and Best case.' }
  }
  if (commit > mostLikely || mostLikely > bestCase) {
    return { ok: false, error: 'Commit must be no more than Most likely, and Most likely no more than Best case.' }
  }
  const base: CallTriple = person.role === 'rep'
    ? repPrefill(ds, qi, week, personId)
    : (rollupWeek(ds, qi, week, input.userCalls.filter((c) => c.personId !== personId)).get(personId)?.reportsSum ?? { commit: 0, mostLikely: 0, bestCase: 0 })
  const differs = Math.abs(commit - base.commit) > OVERRIDE_TOLERANCE || Math.abs(mostLikely - base.mostLikely) > OVERRIDE_TOLERANCE
  const reason = (values.reason ?? '').trim()
  if (differs && reason.length === 0) {
    return {
      ok: false,
      error: person.role === 'rep'
        ? 'Add a reason: your call differs from what your deals add up to.'
        : 'Add a reason: your call differs from the sum of your reports\' calls.',
    }
  }
  return {
    ok: true,
    call: { personId, quarterId: q.id, week, commit, mostLikely, bestCase, ...(reason ? { reason } : {}), source: 'user' },
  }
}

// ── The API ──────────────────────────────────────────────────────────────────

export const api: ForecastApi = {
  loadDataset: (seed) => load(seed),
  people: (ds) => ds.org.people,
  reportsOf: (ds, personId) => childrenOf(ds, personId),
  repView,
  teamView,
  croView,
  boardView,
  accuracyView,
  prepareCall,
  deadlineFor: (role) => DEADLINES[role],
  maxWeek: (ds): Week => ds.currentWeek,
}
