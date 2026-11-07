/**
 * STUB implementation of ForecastApi: hand-built, internally consistent sample data matching the approved
 * prototype (board plan $9.0M = SMB 3.6 / MM 2.8 / ENT 2.6; CRO most likely $8.6M; Priya Raman's team
 * plan $1.20M, closed $283k, reps' commit $840k, model $812k, range $705k-$930k).
 *
 * Not real forecasting: seed calls are a fixed table, scaled by week. It does honour userCalls, so a call a
 * visitor submits flows up Rep -> Manager -> Director -> CRO -> Board exactly as the real selectors will.
 * Replaced at merge time by one line in src/ui/api.ts.
 */
import type { ForecastApi } from '../domain/api'
import type {
  AccuracyView, BiasStat, BoardView, Call, CallTriple, ChainStep, Coverage, CroView, Dataset, Deal, DealRow,
  EligibilityResult, ForecastCategory, ModelRange, Org, Person, PersonAccuracy, Quarter, RepView, Segment,
  SegmentRow, Stage, TeamRow, TeamView, ViewInput, Week, WowChange, Account, CommitRuleId,
} from '../domain/types'
import { LATE_STAGES, SEGMENTS } from '../domain/types'

const K = 1000
const M = 1_000_000
const QUARTER_ID = '2026-Q4'
const QUARTER_LABEL = 'Q4 FY26'
const Q_START = '2026-10-01'
const Q_END = '2026-12-31'
const CUR_WEEK = 6

// ───────────────────────── dates ─────────────────────────

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((t(b) - t(a)) / 86_400_000)
}
/** Friday of week w. Week 1 = Oct 2, so week 6 = Nov 6. */
const weekDate = (w: Week) => addDays('2026-10-02', 7 * (w - 1))

// ───────────────────────── org ─────────────────────────

interface RepCfg {
  id: string; name: string; mgr: string; seg: Segment
  quota: number; closed: number; commit: number; ml: number; bc: number // $k
  model: number // p50, $k
  ratio: number | null // commit ratio (actual / commit), null = no history
  cov: number // open pipeline / remaining quota
}

const REPS: RepCfg[] = [
  { id: 'rep-marcus', name: 'Marcus Lee', mgr: 'mgr-priya', seg: 'MM', quota: 300, closed: 70, commit: 210, ml: 245, bc: 315, model: 205, ratio: 1.038, cov: 3.6 },
  { id: 'rep-ana', name: 'Ana Souza', mgr: 'mgr-priya', seg: 'MM', quota: 260, closed: 62, commit: 205, ml: 240, bc: 310, model: 172, ratio: 0.82, cov: 3.3 },
  { id: 'rep-tom', name: 'Tom Becker', mgr: 'mgr-priya', seg: 'MM', quota: 230, closed: 48, commit: 150, ml: 180, bc: 240, model: 158, ratio: 0.973, cov: 3.1 },
  { id: 'rep-grace', name: 'Grace Kim', mgr: 'mgr-priya', seg: 'MM', quota: 250, closed: 75, commit: 190, ml: 215, bc: 270, model: 181, ratio: 0.91, cov: 2.9 },
  { id: 'rep-diego', name: 'Diego Ruiz', mgr: 'mgr-priya', seg: 'MM', quota: 160, closed: 28, commit: 85, ml: 110, bc: 130, model: 96, ratio: null, cov: 3.4 },
  { id: 'rep-lena', name: 'Lena Fischer', mgr: 'mgr-hannah', seg: 'MM', quota: 820, closed: 340, commit: 780, ml: 900, bc: 1050, model: 830, ratio: 0.93, cov: 3.4 },
  { id: 'rep-omar', name: 'Omar Haddad', mgr: 'mgr-hannah', seg: 'MM', quota: 780, closed: 310, commit: 700, ml: 820, bc: 950, model: 758, ratio: 0.88, cov: 3.2 },
  { id: 'rep-noah', name: 'Noah Price', mgr: 'mgr-sam', seg: 'SMB', quota: 1800, closed: 700, commit: 1550, ml: 1650, bc: 1800, model: 1750, ratio: 0.96, cov: 2.4 },
  { id: 'rep-zoe', name: 'Zoe Martin', mgr: 'mgr-sam', seg: 'SMB', quota: 1800, closed: 640, commit: 1450, ml: 1600, bc: 1750, model: 1700, ratio: 1.02, cov: 2.3 },
  { id: 'rep-victor', name: 'Victor Hale', mgr: 'mgr-mei', seg: 'ENT', quota: 1300, closed: 420, commit: 1000, ml: 1150, bc: 1400, model: 1260, ratio: 0.85, cov: 4.3 },
  { id: 'rep-ines', name: 'Ines Moreau', mgr: 'mgr-mei', seg: 'ENT', quota: 1300, closed: 380, commit: 1000, ml: 1150, bc: 1350, model: 1290, ratio: 0.94, cov: 4.1 },
]

const PEOPLE: Person[] = [
  { id: 'cro', name: 'Elena Novak', role: 'cro', quota: 9 * M, title: 'Chief Revenue Officer' },
  { id: 'dir-smb', name: 'Jonas Weber', role: 'director', segment: 'SMB', managerId: 'cro', quota: 3.6 * M, title: 'SMB' },
  { id: 'dir-mm', name: 'Rachel Okafor', role: 'director', segment: 'MM', managerId: 'cro', quota: 2.8 * M, title: 'Mid-Market' },
  { id: 'dir-ent', name: 'David Chen', role: 'director', segment: 'ENT', managerId: 'cro', quota: 2.6 * M, title: 'Enterprise' },
  { id: 'mgr-priya', name: 'Priya Raman', role: 'manager', segment: 'MM', managerId: 'dir-mm', quota: 1200 * K, title: 'Mid-Market East' },
  { id: 'mgr-hannah', name: 'Hannah Brooks', role: 'manager', segment: 'MM', managerId: 'dir-mm', quota: 1600 * K, title: 'Mid-Market West' },
  { id: 'mgr-sam', name: 'Sam Ortiz', role: 'manager', segment: 'SMB', managerId: 'dir-smb', quota: 3600 * K, title: 'SMB' },
  { id: 'mgr-mei', name: 'Mei Tanaka', role: 'manager', segment: 'ENT', managerId: 'dir-ent', quota: 2600 * K, title: 'Enterprise' },
  ...REPS.map<Person>((r) => ({
    id: r.id, name: r.name, role: 'rep', segment: r.seg, managerId: r.mgr, quota: r.quota * K, title: 'Account Executive',
  })),
]
const BY_ID = new Map(PEOPLE.map((p) => [p.id, p]))
const REP_BY_ID = new Map(REPS.map((r) => [r.id, r]))
const person = (id: string): Person => {
  const p = BY_ID.get(id)
  if (!p) throw new Error(`Unknown person ${id}`)
  return p
}
const children = (id: string) => PEOPLE.filter((p) => p.managerId === id).sort((a, b) => a.name.localeCompare(b.name))
function subtreeReps(id: string): string[] {
  const p = person(id)
  if (p.role === 'rep') return [id]
  return children(id).flatMap((c) => subtreeReps(c.id))
}

// ───────────────────────── seed calls ($k) ─────────────────────────

/** Seed calls for the current week. Managers, directors and CRO have their own call stored separately. */
const SEED: Record<string, [number, number, number]> = {
  'mgr-priya': [820, 960, 1230], 'mgr-hannah': [1500, 1700, 1950], 'mgr-sam': [3150, 3400, 3650], 'mgr-mei': [2150, 2400, 2850],
  'dir-mm': [2300, 2600, 2900], 'dir-smb': [3300, 3500, 3700], 'dir-ent': [2300, 2500, 2800],
  cro: [7900, 8600, 9400],
}
for (const r of REPS) SEED[r.id] = [r.commit, r.ml, r.bc]

const SEED_REASON: Record<string, string> = {
  'mgr-priya': "Holding back Northwind and Brightlane until there's a named buyer; Grace's pipeline is thin.",
  'mgr-hannah': "Reps' sum holds. Lena's Fairhaven deal slides to January, offset by an upsell Omar pulled in.",
  'mgr-sam': 'Model runs ahead of reps on trial conversion, so I added the gap on most likely.',
  'mgr-mei': 'Adding an Enterprise upgrade that no rep has called yet.',
  'dir-mm': 'Two January-weighted deals removed from best case.',
  'dir-smb': 'Credit-pack top-ups are running above the model.',
  'dir-ent': "Holding at managers' view; one legal review could slip a week.",
}

/** People who have not yet submitted this week (so the visitor can). Everyone else is seeded as submitted. */
const NOT_YET = new Set(['mgr-priya', 'dir-mm', 'dir-smb', 'dir-ent', 'cro'])

const TREND_ML = [8.9, 8.8, 8.7, 8.5, 8.4, 8.6]
const TREND_MODEL = [8.6, 8.5, 8.5, 8.4, 8.4, 8.4]
const TREND_HALF = [1.0, 0.95, 0.9, 0.85, 0.8, 0.8]
const clampW = (w: Week) => Math.min(CUR_WEEK, Math.max(1, w))
const mult = (w: Week) => TREND_ML[clampW(w) - 1] / 8.6
const closedMult = (w: Week) => Math.pow(clampW(w) / CUR_WEEK, 1.25)

function userCall(id: string, input: ViewInput): Call | null {
  const hits = input.userCalls.filter((c) => c.personId === id && c.week === input.week)
  return hits.length ? hits[hits.length - 1] : null
}
type Triple = CallTriple
function seedCall(id: string, w: Week): Triple {
  const [c, m, b] = SEED[id]
  const f = mult(w)
  return { commit: Math.round(c * f) * K, mostLikely: Math.round(m * f) * K, bestCase: Math.round(b * f) * K }
}
function callFor(id: string, input: ViewInput): Triple {
  const u = userCall(id, input)
  return u ? { commit: u.commit, mostLikely: u.mostLikely, bestCase: u.bestCase } : seedCall(id, input.week)
}
function ownCallOf(id: string, input: ViewInput): Call | null {
  const u = userCall(id, input)
  if (u) return u
  if (NOT_YET.has(id)) return null
  return {
    personId: id, quarterId: QUARTER_ID, week: input.week, ...seedCall(id, input.week),
    reason: SEED_REASON[id], source: 'seed',
  }
}
const reasonOf = (id: string, input: ViewInput) => userCall(id, input)?.reason ?? SEED_REASON[id]
const zero = (): Triple => ({ commit: 0, mostLikely: 0, bestCase: 0 })
const addT = (a: Triple, b: Triple): Triple => ({
  commit: a.commit + b.commit, mostLikely: a.mostLikely + b.mostLikely, bestCase: a.bestCase + b.bestCase,
})
const sumT = (ts: Triple[]) => ts.reduce(addT, zero())
const reportsSumOf = (id: string, input: ViewInput) => sumT(children(id).map((c) => callFor(c.id, input)))

// ───────────────────────── models & bias ─────────────────────────

function rangeFrom(p50: number, spread: number): ModelRange {
  return {
    p10: Math.round(p50 * (1 - spread)), p25: Math.round(p50 * (1 - spread * 0.45)), p50,
    p75: Math.round(p50 * (1 + spread * 0.45)), p90: Math.round(p50 * (1 + spread * 1.05)),
  }
}
const MODEL_OVERRIDE: Record<string, ModelRange> = {
  'mgr-priya': { p10: 705 * K, p25: 760 * K, p50: 812 * K, p75: 870 * K, p90: 930 * K },
  'dir-smb': { p10: 3100 * K, p25: 3270 * K, p50: 3450 * K, p75: 3620 * K, p90: 3800 * K },
  'dir-mm': { p10: 2150 * K, p25: 2280 * K, p50: 2400 * K, p75: 2530 * K, p90: 2650 * K },
  'dir-ent': { p10: 2200 * K, p25: 2390 * K, p50: 2550 * K, p75: 2720 * K, p90: 2900 * K },
}
const CRO_MODEL = (w: Week): ModelRange => {
  const p50 = TREND_MODEL[clampW(w) - 1] * M
  const h = TREND_HALF[clampW(w) - 1] * M
  return { p10: p50 - h, p25: p50 - h / 2, p50, p75: p50 + h / 2, p90: p50 + h }
}
function modelOf(id: string, w: Week = CUR_WEEK): ModelRange {
  if (id === 'cro') return CRO_MODEL(w)
  if (MODEL_OVERRIDE[id]) return MODEL_OVERRIDE[id]
  const r = REP_BY_ID.get(id)
  if (r) return rangeFrom(r.model * K, 0.14)
  const p50 = children(id).reduce((s, c) => s + modelOf(c.id, w).p50, 0)
  return rangeFrom(p50, 0.1)
}
const PERSON_BIAS: Record<string, { commit: number; ml: number; mape: number; n: number } | null> = {
  cro: { commit: 0.98, ml: 0.99, mape: 0.03, n: 4 },
  'dir-smb': { commit: 0.97, ml: 0.99, mape: 0.04, n: 4 }, 'dir-mm': { commit: 0.94, ml: 0.97, mape: 0.05, n: 4 },
  'dir-ent': { commit: 0.9, ml: 0.95, mape: 0.07, n: 4 },
  'mgr-priya': { commit: 0.93, ml: 0.96, mape: 0.07, n: 4 }, 'mgr-hannah': { commit: 0.91, ml: 0.95, mape: 0.08, n: 4 },
  'mgr-sam': { commit: 0.98, ml: 1.0, mape: 0.05, n: 4 }, 'mgr-mei': { commit: 0.87, ml: 0.93, mape: 0.09, n: 4 },
}
function biasOf(id: string): BiasStat | null {
  const r = REP_BY_ID.get(id)
  if (r) return r.ratio == null ? null : { commitRatio: r.ratio, mostLikelyRatio: Math.min(1.08, r.ratio + 0.05), quartersUsed: 4 }
  const b = PERSON_BIAS[id]
  return b ? { commitRatio: b.commit, mostLikelyRatio: b.ml, quartersUsed: b.n } : null
}

// ───────────────────────── deals ─────────────────────────

interface Opts { eb?: boolean; plan?: boolean; idle?: number; pushes?: number; type?: 'New' | 'Expansion' }
let dealSeq = 0
let accSeq = 0
const DEALS: Deal[] = []
const ACCOUNTS: Account[] = []
const NAME_POOL = [
  'Cobalt Freight', 'Pinecrest Group', 'Altair Foods', 'Solstice Labs', 'Meridian Care', 'Quill & Co', 'Redwood Bio',
  'Juniper Pay', 'Granite Works', 'Opal Health', 'Thistle & Co', 'Aurora Print', 'Pebble Finance', 'Larkspur Education',
  'Mosaic Health', 'Harborview Retail', 'Ember Logistics', 'Northgate Labs', 'Summit Ridge', 'Cedar & Pine',
  'Vantage Robotics', 'Lighthouse Media', 'Copperleaf', 'Kinetic Fitness', 'Bluebird Travel', 'Atlas Mobility',
  'Fernwood Legal', 'Silverline Pay', 'Marigold Foods', 'Tessera Energy', 'Wren Analytics', 'Oakridge Homes',
  'Paperboat', 'Nimbus Health', 'Quarry Digital', 'Ashgrove', 'Delta Harbor', 'Evergreen Learning', 'Falcon Supply',
  'Gable & Rowe', 'Ironwood Labs', 'Jetstream Air', 'Kelp Studio', 'Lantern Care', 'Maple Street Bank', 'Nova Dental',
  'Osprey Capital', 'Plume Software', 'Quartz Retail', 'Rivet Works', 'Sage Mobility', 'Tundra Foods', 'Umber Games',
  'Verity Legal', 'Willow Health', 'Yarrow Energy', 'Zephyr Cloud', 'Brightfield', 'Crestline', 'Dovetail',
]
let namePtr = 0
const nextName = () => NAME_POOL[namePtr++ % NAME_POOL.length] + (namePtr > NAME_POOL.length ? ` ${Math.floor(namePtr / NAME_POOL.length) + 1}` : '')
const TIER_BY_SEG: Record<Segment, Account['tier']> = { SMB: 'Teams', MM: 'Teams', ENT: 'Enterprise' }

function addDeal(owner: string, account: string, amountK: number, stage: Stage, cat: ForecastCategory, close: string, o: Opts = {}) {
  const seg = person(owner).segment ?? 'MM'
  dealSeq++
  const accId = `acc-${++accSeq}`
  ACCOUNTS.push({
    id: accId, name: account, segment: seg, ownerId: owner, tier: TIER_BY_SEG[seg], seats: 10 + (dealSeq * 7) % 90,
    arr: Math.round(amountK * 0.4) * K, creditsIncluded: 5000, creditUtilisation: [0.5, 0.58, 0.66, 0.72, 0.79, 0.84],
  })
  DEALS.push({
    id: `deal-${dealSeq}`, accountId: accId, accountName: account, name: `${account} - ${o.type === 'Expansion' ? 'seat expansion' : 'new workspace'}`,
    ownerId: owner, segment: seg, type: o.type ?? (dealSeq % 3 === 0 ? 'Expansion' : 'New'), amount: amountK * K, stage, category: cat,
    closeDate: close, createdDate: addDays(close, -75 - (dealSeq % 5) * 9),
    economicBuyerIdentified: o.eb ?? true, mutualClosePlan: o.plan ?? true,
    lastActivityDate: addDays(weekDate(CUR_WEEK), -(o.idle ?? 2 + (dealSeq % 6))), closeDatePushes: o.pushes ?? 0,
    qualityScore: 55 + (dealSeq * 11) % 40,
  })
}

/** Hand-built deals for Priya's team: these produce the prototype's four risky commits ($123k). */
const D = addDeal
D('rep-marcus', 'Harbor Analytics', 70, 'Closed Won', 'Closed Won', '2026-10-21')
D('rep-marcus', 'Lumen Retail', 85, 'Contracting', 'Commit', '2026-12-03')
D('rep-marcus', 'Fathom Systems', 55, 'Negotiation', 'Commit', '2026-11-26')
D('rep-marcus', 'Pinecrest Group', 60, 'Proposal', 'Best Case', '2026-12-10')
D('rep-marcus', 'Altair Foods', 45, 'Negotiation', 'Best Case', '2026-12-15')
D('rep-ana', 'Tidewater Co', 62, 'Closed Won', 'Closed Won', '2026-10-28')
D('rep-ana', 'Northwind Logistics', 48, 'Negotiation', 'Commit', '2026-12-12', { eb: false, pushes: 2 })
D('rep-ana', 'Brightlane Health', 22, 'Contracting', 'Commit', '2026-11-28', { idle: 19 })
D('rep-ana', 'Cobalt Freight', 73, 'Contracting', 'Commit', '2026-11-21')
D('rep-ana', 'Ironbark Energy', 60, 'Proposal', 'Best Case', '2026-12-18')
D('rep-ana', 'Vela Mobility', 45, 'Negotiation', 'Best Case', '2026-12-09')
D('rep-tom', 'Beacon Print', 48, 'Closed Won', 'Closed Won', '2026-10-14')
D('rep-tom', 'Kestrel Media', 35, 'Proposal', 'Commit', '2026-12-05')
D('rep-tom', 'Orchid Software', 67, 'Contracting', 'Commit', '2026-11-24')
D('rep-tom', 'Marlow Dental', 50, 'Negotiation', 'Best Case', '2026-12-12')
D('rep-tom', 'Sable Studios', 40, 'Proposal', 'Best Case', '2026-12-20')
D('rep-grace', 'Westbrook Legal', 40, 'Closed Won', 'Closed Won', '2026-10-17')
D('rep-grace', 'Foxglove Tech', 35, 'Closed Won', 'Closed Won', '2026-10-30')
D('rep-grace', 'Halcyon Travel', 65, 'Contracting', 'Commit', '2026-11-25')
D('rep-grace', 'Driftwood Games', 50, 'Negotiation', 'Commit', '2026-12-08')
D('rep-grace', 'Larkspur Education', 50, 'Proposal', 'Best Case', '2026-12-11')
D('rep-grace', 'Mosaic Health', 30, 'Negotiation', 'Best Case', '2026-12-17')
D('rep-diego', 'Pavilion Events', 28, 'Closed Won', 'Closed Won', '2026-10-24')
D('rep-diego', 'Orbit Labs', 18, 'Negotiation', 'Commit', '2026-12-19', { plan: false })
D('rep-diego', 'Cinder Foods', 39, 'Contracting', 'Commit', '2026-12-02')
D('rep-diego', 'Ferry Street', 25, 'Proposal', 'Best Case', '2026-12-16')
D('rep-diego', 'Tern Analytics', 20, 'Proposal', 'Best Case', '2026-12-22')

function split(total: number, n: number): number[] {
  const w = [0.34, 0.26, 0.2, 0.12, 0.08].slice(0, n)
  const s = w.reduce((a, b) => a + b, 0)
  const parts = w.map((x) => Math.max(5, Math.round((total * x) / s)))
  parts[0] += total - parts.reduce((a, b) => a + b, 0)
  return parts
}
const COMMIT_DATES = ['2026-11-19', '2026-11-24', '2026-12-02', '2026-12-09', '2026-12-12']
const BC_DATES = ['2026-12-05', '2026-12-11', '2026-12-16', '2026-12-19', '2026-12-22']
const PIPE_DATES = ['2026-12-17', '2026-12-29', '2027-01-20', '2027-02-05', '2027-02-24']
const CW_DATES = ['2026-10-09', '2026-10-16', '2026-10-23', '2026-11-03', '2026-11-05']

for (const r of REPS) {
  const explicit = DEALS.some((d) => d.ownerId === r.id)
  const cnt = (t: number) => Math.min(5, Math.max(1, Math.ceil(t / 280)))
  if (!explicit) {
    split(r.closed, cnt(r.closed)).forEach((a, i) => D(r.id, nextName(), a, 'Closed Won', 'Closed Won', CW_DATES[i]))
    split(r.commit - r.closed, cnt(r.commit - r.closed)).forEach((a, i) =>
      D(r.id, nextName(), a, i % 2 ? 'Negotiation' : 'Contracting', 'Commit', COMMIT_DATES[i]))
    split(r.bc - r.commit, cnt(r.bc - r.commit)).forEach((a, i) =>
      D(r.id, nextName(), a, i % 2 ? 'Proposal' : 'Negotiation', 'Best Case', BC_DATES[i]))
  }
  const open = DEALS.filter((d) => d.ownerId === r.id && (d.category === 'Commit' || d.category === 'Best Case'))
    .reduce((s, d) => s + d.amount / K, 0)
  const pipeTotal = Math.max(40, Math.round(r.cov * (r.quota - r.closed) - open))
  const stages: Stage[] = ['Solution', 'Qualification', 'Discovery', 'Qualification']
  split(pipeTotal, cnt(pipeTotal)).forEach((a, i) =>
    D(r.id, nextName(), a, stages[i % 4], 'Pipeline', PIPE_DATES[i], { eb: i === 0 }))
}
// A few deliberate risky commits elsewhere so the Director/CRO lists are not just Priya's team.
{
  const lena = DEALS.find((d) => d.ownerId === 'rep-lena' && d.category === 'Commit')
  if (lena) { lena.economicBuyerIdentified = false; lena.closeDatePushes = 2 }
  const victor = DEALS.find((d) => d.ownerId === 'rep-victor' && d.category === 'Commit')
  if (victor) { victor.stage = 'Proposal'; victor.lastActivityDate = addDays(weekDate(CUR_WEEK), -16) }
}

const dealsOf = (ids: string[]) => DEALS.filter((d) => ids.includes(d.ownerId))

function evaluate(d: Deal, w: Week): EligibilityResult {
  const asOf = weekDate(w)
  const failed: { id: CommitRuleId; label: string }[] = []
  if (!LATE_STAGES.includes(d.stage)) failed.push({ id: 'late-stage', label: `Still at ${d.stage} stage` })
  if (d.closeDate < Q_START || d.closeDate > Q_END) failed.push({ id: 'close-in-quarter', label: 'Close date is outside the quarter' })
  if (!d.economicBuyerIdentified) failed.push({ id: 'economic-buyer', label: 'No economic buyer identified' })
  if (!d.mutualClosePlan) failed.push({ id: 'close-plan', label: 'No mutual close plan' })
  const idle = daysBetween(d.lastActivityDate, asOf)
  if (idle > 14) failed.push({ id: 'recent-activity', label: `No activity for ${idle} days` })
  if (d.closeDatePushes > 1) failed.push({ id: 'push-limit', label: `Close date pushed ${d.closeDatePushes} times` })
  return { eligible: failed.length === 0, failedRules: failed }
}
const WIN_BASE: Record<Stage, number> = {
  Discovery: 0.08, Qualification: 0.15, Solution: 0.26, Proposal: 0.4, Negotiation: 0.62, Contracting: 0.85, 'Closed Won': 1, 'Closed Lost': 0,
}
function toRow(d: Deal, w: Week): DealRow {
  const eligibility = evaluate(d, w)
  let p = WIN_BASE[d.stage]
  if (d.stage !== 'Closed Won') {
    p -= d.closeDatePushes * 0.06
    if (!d.economicBuyerIdentified) p -= 0.1
    if (!d.mutualClosePlan) p -= 0.05
    if (!eligibility.failedRules.every((f) => f.id !== 'recent-activity')) p -= 0.08
    p = Math.min(0.95, Math.max(0.03, p))
  }
  return { deal: d, eligibility, commitAtRisk: d.category === 'Commit' && !eligibility.eligible, winProbability: Math.round(p * 100) / 100 }
}
const riskyOf = (ids: string[], w: Week) => dealsOf(ids).map((d) => toRow(d, w)).filter((r) => r.commitAtRisk).sort((a, b) => b.deal.amount - a.deal.amount)

const closedOf = (ids: string[], w: Week) => Math.round(ids.reduce((s, id) => s + (REP_BY_ID.get(id)?.closed ?? 0), 0) * closedMult(w)) * K
const COV_TARGET: Record<Segment, number> = { SMB: 2.5, MM: 3, ENT: 4 }
function coverageOf(ids: string[], plan: number, w: Week, seg?: Segment): Coverage {
  const closed = closedOf(ids, w)
  const open = dealsOf(ids).filter((d) => d.category === 'Pipeline' || d.category === 'Best Case' || d.category === 'Commit')
    .reduce((s, d) => s + d.amount, 0)
  const remaining = Math.max(1, plan - closed)
  return { openPipeline: open, remaining, ratio: open / remaining, target: seg ? COV_TARGET[seg] : 3.2 }
}
const segOf = (id: string) => person(id).segment

// ───────────────────────── dataset ─────────────────────────

let cached: Dataset | null = null
function buildDataset(): Dataset {
  const org: Org = { people: PEOPLE, croId: 'cro', boardPlan: 9 * M }
  const labels = ['Q4 FY25', 'Q1 FY26', 'Q2 FY26', 'Q3 FY26']
  const closedQs: Quarter[] = labels.map((label, i) => ({
    id: `2025-q${i + 4}`, label, start: '', end: '', isCurrent: false, weeksElapsed: 13,
    plan: { SMB: 2.9 * M, MM: 2.2 * M, ENT: 2.1 * M }, startingArr: (92 + i * 7) * M, snapshots: [], calls: [],
  }))
  const current: Quarter = {
    id: QUARTER_ID, label: QUARTER_LABEL, start: Q_START, end: Q_END, isCurrent: true, weeksElapsed: CUR_WEEK,
    plan: { SMB: 3.6 * M, MM: 2.8 * M, ENT: 2.6 * M }, startingArr: 120 * M,
    snapshots: Array.from({ length: CUR_WEEK }, (_, i) => ({
      week: i + 1, asOf: weekDate(i + 1), deals: DEALS, churn: [],
      smbFunnel: { trialsStarted: 4200 + i * 700, paidConversions: 300 + i * 52, selfServeArr: Math.round(0.4 * M + i * 0.5 * M) },
    })),
    calls: [],
  }
  return { seed: 7, company: 'Shipwright', org, accounts: ACCOUNTS, quarters: [...closedQs, current], currentWeek: CUR_WEEK }
}

// ───────────────────────── view builders ─────────────────────────

const DEADLINES: Record<Person['role'], string> = {
  rep: 'Monday 17:00', manager: 'Tuesday 17:00', director: 'Wednesday 17:00', cro: 'Thursday 17:00',
}
const pctOf = (v: number) => `${Math.round(v * 100)}%`

function rowWarning(id: string, call: Triple, w: Week): string | null {
  const parts: string[] = []
  const ids = subtreeReps(id)
  const risky = riskyOf(ids, w).length
  const model = modelOf(id, w).p50
  if (risky) parts.push(`${risky} risky commit${risky > 1 ? 's' : ''}`)
  if (call.commit > model * 1.12) parts.push(risky ? 'above model' : `Commit ${pctOf(call.commit / model - 1)} above model`)
  const p = person(id)
  const cov = coverageOf(ids, p.quota, w, segOf(id))
  if (!parts.length && cov.ratio < cov.target) return `Thin pipeline, ${cov.ratio.toFixed(1)}× coverage`
  return parts.length ? parts.join(', ') : null
}

function teamRow(p: Person, input: ViewInput): TeamRow {
  const call = callFor(p.id, input)
  const bias = biasOf(p.id)
  return {
    person: p, call,
    likelyToLand: bias ? Math.round((call.commit * bias.commitRatio) / K) * K : null,
    biasNote: bias ? `lands at ${pctOf(bias.commitRatio)} of commit on average` : 'Ramping, no track record yet',
    model: modelOf(p.id, input.week).p50,
    warning: rowWarning(p.id, call, input.week),
    submitted: !!userCall(p.id, input) || !NOT_YET.has(p.id),
  }
}

function repViewOf(input: ViewInput, id: string): RepView {
  const r = REP_BY_ID.get(id)
  const p = person(id)
  const seed = seedCall(id, input.week)
  return {
    person: p, quarterLabel: QUARTER_LABEL, week: input.week, deadline: DEADLINES.rep, quota: p.quota,
    closed: closedOf([id], input.week), prefill: seed, submitted: ownCallOf(id, input),
    deals: DEALS.filter((d) => d.ownerId === id).map((d) => toRow(d, input.week)),
    model: modelOf(id, input.week), bias: biasOf(id),
    coverage: coverageOf([id], p.quota, input.week, r?.seg),
  }
}

function teamViewOf(input: ViewInput, id: string): TeamView {
  const p = person(id)
  const kids = children(id)
  const ids = subtreeReps(id)
  const reportsSum = reportsSumOf(id, input)
  const closed = closedOf(ids, input.week)
  const noun = p.role === 'manager' ? 'rep' : 'manager'
  return {
    person: p, quarterLabel: QUARTER_LABEL, week: input.week, deadline: DEADLINES[p.role],
    reportsLabel: `${kids.length} ${noun}${kids.length === 1 ? '' : 's'}`,
    rows: kids.map((k) => teamRow(k, input)),
    reportsSum, ownCall: ownCallOf(id, input), model: modelOf(id, input.week),
    pathToPlan: {
      plan: p.quota, closed, committedOpen: Math.max(0, reportsSum.commit - closed), gap: Math.max(0, p.quota - reportsSum.commit),
      changeSinceLastWeek: input.week > 1 ? Math.round((reportsSum.commit * 0.0333) / K) * K : 0,
    },
    atRiskCommits: riskyOf(ids, input.week),
    coverage: coverageOf(ids, p.quota, input.week, segOf(id)),
  }
}

function croViewOf(input: ViewInput): CroView {
  const cro = person('cro')
  const dirs = children('cro')
  const segments: SegmentRow[] = SEGMENTS.map((seg) => {
    const d = dirs.find((x) => x.segment === seg) as Person
    return {
      segment: seg, directorName: d.name, plan: d.quota, call: callFor(d.id, input), model: modelOf(d.id, input.week),
      closed: closedOf(subtreeReps(d.id), input.week), coverage: coverageOf(subtreeReps(d.id), d.quota, input.week, seg),
    }
  })
  const reps = PEOPLE.filter((x) => x.role === 'rep')
  const mgrs = PEOPLE.filter((x) => x.role === 'manager')
  const levels: { level: ChainStep['level']; people: Person[]; value: Triple }[] = [
    { level: 'Reps', people: reps, value: sumT(reps.map((x) => callFor(x.id, input))) },
    { level: 'Managers', people: mgrs, value: sumT(mgrs.map((x) => callFor(x.id, input))) },
    { level: 'Directors', people: dirs, value: sumT(dirs.map((x) => callFor(x.id, input))) },
    { level: 'CRO', people: [cro], value: callFor('cro', input) },
  ]
  const chain: ChainStep[] = levels.map((l, i) => ({
    level: l.level, value: l.value, delta: i === 0 ? 0 : l.value.mostLikely - levels[i - 1].value.mostLikely,
    reasons: i === 0 ? [] : l.people.flatMap((x) => {
      const text = reasonOf(x.id, input)
      return text ? [{ personName: x.name, text }] : []
    }),
  }))
  const to = callFor('cro', input).mostLikely
  const from = input.week > 1 ? Math.round(TREND_ML[clampW(input.week - 1) - 1] * M) : to
  const f = 0.75 + ((input.week * 37) % 7) / 14
  const gross: WowChange[] = input.week > 1 ? [
    { kind: 'new', amount: Math.round(400 * f) * K, dealCount: 9 },
    { kind: 'pulled-in', amount: Math.round(150 * f) * K, dealCount: 4 },
    { kind: 'pushed', amount: -Math.round(220 * f) * K, dealCount: 6 },
    { kind: 'lost', amount: -Math.round(140 * f) * K, dealCount: 3 },
    { kind: 'won', amount: Math.round(50 * f) * K, dealCount: 2 },
  ] : []
  const residual = to - from - gross.reduce((s, c) => s + c.amount, 0)
  const changes = input.week > 1 && Math.abs(residual) >= 5 * K ? [...gross, { kind: 'amount-change' as const, amount: residual, dealCount: 5 }] : gross
  return {
    person: cro, quarterLabel: QUARTER_LABEL, week: input.week, deadline: DEADLINES.cro, segments,
    reportsSum: sumT(dirs.map((d) => callFor(d.id, input))), ownCall: ownCallOf('cro', input),
    model: modelOf('cro', input.week), plan: cro.quota, chain, wow: { from, to, changes },
  }
}

function boardViewOf(input: ViewInput): BoardView {
  const call = callFor('cro', input)
  const f = call.mostLikely / (8.6 * M)
  const dirs = children('cro')
  return {
    quarterLabel: QUARTER_LABEL, week: input.week, call, plan: 9 * M, model: modelOf('cro', input.week),
    accuracyNote: 'Our week-6 call has landed within 3% of the final result for the last 4 quarters.',
    bridge: {
      startingArr: 120 * M, newArr: Math.round(6.1 * M * f), expansionArr: Math.round(4.3 * M * f), churnArr: Math.round(1.8 * M * f),
      endingArr: 120 * M + call.mostLikely,
    },
    trend: Array.from({ length: 13 }, (_, i) => {
      const w = i + 1
      if (w > input.week) return { week: w, call: null, model: null }
      return { week: w, call: w === input.week ? call.mostLikely : Math.round(TREND_ML[clampW(w) - 1] * M), model: modelOf('cro', w) }
    }),
    segments: SEGMENTS.map((segment) => {
      const d = dirs.find((x) => x.segment === segment) as Person
      return { segment, call: callFor(d.id, input).mostLikely, plan: d.quota }
    }),
    kpis: [
      { id: 'nrr', label: 'Net revenue retention', value: 1.12, unit: '%', change: 0.02 },
      { id: 'grr', label: 'Gross revenue retention', value: 0.91, unit: '%', change: -0.01 },
      { id: 'credit-utilisation', label: 'Credit utilisation', value: 0.74, unit: '%', change: 0.05 },
      { id: 'coverage', label: 'Pipeline coverage', value: 3.0, unit: 'x', change: null, target: 3.2 },
    ],
  }
}

function accuracyViewOf(): AccuracyView {
  const levels: { level: ChainStep['level']; start: number; wobble: number }[] = [
    { level: 'Reps', start: 0.78, wobble: 1 }, { level: 'Managers', start: 0.84, wobble: 2 },
    { level: 'Directors', start: 0.89, wobble: 3 }, { level: 'CRO', start: 0.93, wobble: 4 },
  ]
  const byWeek = levels.map((l) => ({
    level: l.level,
    points: Array.from({ length: 13 }, (_, i) => {
      const w = i + 1
      const t = (w - 1) / 12
      const end = 0.95 + l.wobble * 0.011
      const ratio = l.start + (end - l.start) * (1 - Math.pow(1 - t, 1.7)) + Math.sin(w * l.wobble) * 0.008 * (1 - t)
      return { week: w, ratio: Math.round(ratio * 1000) / 1000 }
    }),
  }))
  const people: PersonAccuracy[] = PEOPLE.flatMap((p) => {
    const bias = biasOf(p.id)
    if (!bias) return []
    const r = REP_BY_ID.get(p.id)
    const mape = r ? Math.round((Math.abs(1 - bias.mostLikelyRatio) * 1.4 + 0.035) * 1000) / 1000 : PERSON_BIAS[p.id]?.mape ?? 0.06
    return [{ person: p, bias, mape }]
  })
  const cal = (rows: [string, number, number][], spread: number) =>
    rows.map(([quarterLabel, actualK, modelK]) => {
      const model = rangeFrom(modelK * K, spread)
      const actual = actualK * K
      return { quarterLabel, actual, model, insideP10P90: actual >= model.p10 && actual <= model.p90 }
    })
  return {
    byWeek, people,
    calibration: [
      { segment: 'SMB', rows: cal([['Q4 FY25', 2610, 2700], ['Q1 FY26', 2940, 2880], ['Q2 FY26', 3050, 3240], ['Q3 FY26', 3320, 3280]], 0.1) },
      { segment: 'MM', rows: cal([['Q4 FY25', 1890, 2050], ['Q1 FY26', 2100, 2160], ['Q2 FY26', 2310, 2180], ['Q3 FY26', 2290, 2400]], 0.12) },
      { segment: 'ENT', rows: cal([['Q4 FY25', 1700, 2060], ['Q1 FY26', 2140, 2090], ['Q2 FY26', 2380, 2350], ['Q3 FY26', 2470, 2440]], 0.1) },
    ],
    slipRate: 0.18, pushRate: 0.34, commitConversion: 0.87,
  }
}

// ───────────────────────── the API ─────────────────────────

function baselineFor(id: string, input: ViewInput): Triple {
  const p = person(id)
  return p.role === 'rep' ? seedCall(id, input.week) : reportsSumOf(id, input)
}

export const api: ForecastApi = {
  loadDataset() {
    cached ??= buildDataset()
    return cached
  },
  people: () => PEOPLE,
  reportsOf: (_ds, id) => children(id),
  repView: (_ds, input, id) => repViewOf(input, id),
  teamView: (_ds, input, id) => teamViewOf(input, id),
  croView: (_ds, input) => croViewOf(input),
  boardView: (_ds, input) => boardViewOf(input),
  accuracyView: () => accuracyViewOf(),
  prepareCall(_ds, input, personId, values) {
    const { commit, mostLikely, bestCase } = values
    if ([commit, mostLikely, bestCase].some((v) => !Number.isFinite(v) || v < 0)) return { ok: false, error: 'Enter all three numbers.' }
    if (commit > mostLikely) return { ok: false, error: 'Commit cannot be higher than Most likely.' }
    if (mostLikely > bestCase) return { ok: false, error: 'Most likely cannot be higher than Best case.' }
    const base = baselineFor(personId, input)
    const changed = commit !== base.commit || mostLikely !== base.mostLikely || bestCase !== base.bestCase
    const reason = values.reason?.trim()
    if (changed && !reason) {
      const what = person(personId).role === 'rep' ? "what your deals add up to" : "what your team's calls add up to"
      return { ok: false, error: `Your call differs from ${what}. Add a short reason so the next level can see why.` }
    }
    return {
      ok: true,
      call: { personId, quarterId: QUARTER_ID, week: input.week, commit, mostLikely, bestCase, reason: reason || undefined, source: 'user' },
    }
  },
  deadlineFor: (role) => DEADLINES[role],
  maxWeek: () => CUR_WEEK,
}
