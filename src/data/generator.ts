import { createRng } from './rng'
import type { Rng } from './rng'
import {
  COMPANY_PREFIX, COMPANY_SUFFIX, ENT_REP_NAMES, MM_WEST_REP_NAMES, SMB_REP_NAMES,
} from './names'
import { addDays } from '../domain/dates'
import { checkEligibility } from '../domain/eligibility'
import { seedCalls } from './callSeeder'
import type {
  Account, ChurnItem, Dataset, Deal, DealType, ForecastCategory, Org, Person, Quarter,
  QuarterActuals, Segment, SmbFunnel, Stage, Tier, WeekSnapshot,
} from '../domain/types'

// ───────────────────────── Static configuration ─────────────────────────

export interface QuarterDef {
  id: string
  label: string
  start: string
  end: string
  /** Plan relative to the current quarter. */
  scale: number
  /** Pipeline volume multiplier (the current quarter has a healthier pipeline). */
  volume?: number
  /** Churn multiplier. */
  churn?: number
}

export const QUARTER_DEFS: QuarterDef[] = [
  { id: '2025-Q4', label: 'Q4 2025', start: '2025-10-01', end: '2025-12-31', scale: 0.745 },
  { id: '2026-Q1', label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31', scale: 0.8 },
  { id: '2026-Q2', label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30', scale: 0.865 },
  { id: '2026-Q3', label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30', scale: 0.93 },
  { id: '2026-Q4', label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31', scale: 1, volume: 0.92, churn: 0.85 },
]
export const CURRENT_WEEK = 6
export const SEGMENT_PLAN: Record<Segment, number> = { SMB: 3_600_000, MM: 2_800_000, ENT: 2_600_000 }

const STAGES: Stage[] = ['Discovery', 'Qualification', 'Solution', 'Proposal', 'Negotiation', 'Contracting']

interface SegParams {
  cycle: number[] // mean days spent in each of the six open stages
  avgNew: number
  /** Expansion deal size as a share of the account's ARR. */
  expShare: number
  pWin: number
  stall: number
  newShare: number
  /** Net share of the segment plan that deals are expected to deliver (rest: self-serve, churn). */
  churnTarget: number
  churnAvg: number
  round: number
  /** Share of generated deals that end up Closed Won inside the quarter (calibrated). */
  fracWin: number
}

const SEG: Record<Segment, SegParams> = {
  SMB: { cycle: [3, 4, 4, 4, 3, 3], avgNew: 16000, expShare: 0.4, pWin: 0.34, stall: 0.2, newShare: 0.22, churnTarget: 540_000, churnAvg: 9500, round: 100, fracWin: 0.29 },
  MM: { cycle: [9, 12, 13, 13, 11, 8], avgNew: 42000, expShare: 0.28, pWin: 0.34, stall: 0.28, newShare: 0.55, churnTarget: 650_000, churnAvg: 38000, round: 500, fracWin: 0.135 },
  ENT: { cycle: [16, 22, 26, 22, 16, 12], avgNew: 110000, expShare: 0.1, pWin: 0.34, stall: 0.3, newShare: 0.52, churnTarget: 1_150_000, churnAvg: 130000, round: 1000, fracWin: 0.15 },
}
const CYCLE_SCALE: Record<Segment, number> = { SMB: 1.15, MM: 1.15, ENT: 1.0 }
const PRE_SHARE: Record<Segment, number> = { SMB: 0.2, MM: 0.35, ENT: 0.55 }
/** Extra never-closing-this-quarter deals per generated deal, by segment. */
const EXTRA_PIPELINE: Record<Segment, number> = { SMB: 0.2, MM: 0.12, ENT: 0.18 }
const SELF_SERVE_TARGET = 1_700_000
const ATTAINMENT = 1.0

export interface RepProfile {
  /** Where the rep's commit lands vs actual, averaged: actual / commit at week 6. <1 = over-calls. */
  landing: number
  /** Chance the rep bumps a deal one category above what the stage implies. */
  opt: number
  /** Chance the rep demotes a deal one category below. */
  cons: number
  aggressive: boolean
  /** Extra chance a deal lacks an economic buyer / close plan. */
  sloppy: number
  /** Multiplier on deal win rates (a hidden trait). */
  skill: number
  firstQuarter: number
}

// ───────────────────────── Org ─────────────────────────

interface RepSpec { name: string; quota: number; profile?: Partial<RepProfile> }
interface ManagerSpec { name: string; title: string; segment: Segment; reps: RepSpec[] }

const MANAGERS: ManagerSpec[] = [
  {
    name: 'Sofia Lindqvist', title: 'SMB Self-Serve Growth', segment: 'SMB',
    reps: [380, 350, 360, 340, 370].map((q, i) => ({ name: SMB_REP_NAMES[i], quota: q * 1000 })),
  },
  {
    name: 'Ben Carter', title: 'SMB Sales-Assist', segment: 'SMB',
    reps: [360, 350, 370, 330, 390].map((q, i) => ({ name: SMB_REP_NAMES[5 + i], quota: q * 1000 })),
  },
  {
    name: 'Priya Raman', title: 'Mid-Market East', segment: 'MM',
    reps: [
      { name: 'Marcus Lee', quota: 260_000, profile: { landing: 1.04, opt: 0.05, cons: 0.05, sloppy: 0, skill: 1.05 } },
      { name: 'Ana Souza', quota: 250_000, profile: { landing: 0.82, opt: 0.3, cons: 0, aggressive: true, sloppy: 0.3, skill: 0.92 } },
      { name: 'Tom Becker', quota: 220_000, profile: { landing: 0.97, opt: 0.14, cons: 0.05, aggressive: true, sloppy: 0.1, skill: 1 } },
      { name: 'Grace Kim', quota: 270_000, profile: { landing: 0.91, opt: 0.1, cons: 0.05, sloppy: 0.06, skill: 1 } },
      { name: 'Diego Ruiz', quota: 200_000, profile: { landing: 1.0, opt: 0.08, cons: 0.1, sloppy: 0.1, skill: 0.95, firstQuarter: 3 } },
    ],
  },
  {
    name: 'Owen Hughes', title: 'Mid-Market West', segment: 'MM',
    reps: [330, 310, 320, 320, 320].map((q, i) => ({ name: MM_WEST_REP_NAMES[i], quota: q * 1000 })),
  },
  {
    name: 'Naomi Fischer', title: 'Enterprise Americas', segment: 'ENT',
    reps: ENT_REP_NAMES.slice(0, 4).map((n) => ({ name: n, quota: 260_000 })),
  },
  {
    name: 'Luca Moretti', title: 'Enterprise EMEA', segment: 'ENT',
    reps: ENT_REP_NAMES.slice(4, 7).map((n) => ({ name: n, quota: 260_000 })),
  },
  {
    name: 'Kenji Watanabe', title: 'Enterprise Strategic', segment: 'ENT',
    reps: ENT_REP_NAMES.slice(7, 10).map((n) => ({ name: n, quota: 260_000 })),
  },
]

const DIRECTORS: { segment: Segment; name: string; title: string }[] = [
  { segment: 'SMB', name: 'Dana Okafor', title: 'SMB' },
  { segment: 'MM', name: 'Helen Park', title: 'Mid-Market' },
  { segment: 'ENT', name: 'Rafael Moreno', title: 'Enterprise' },
]

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function buildOrg(rng: Rng): { org: Org; profiles: Map<string, RepProfile> } {
  const people: Person[] = []
  const profiles = new Map<string, RepProfile>()
  const cro: Person = { id: 'elena-novak', name: 'Elena Novak', role: 'cro', quota: 0, title: 'Chief Revenue Officer' }
  people.push(cro)
  const sandbaggers = new Set(['Hannah Brooks', 'Victor Alvarez'])
  for (const d of DIRECTORS) {
    const dir: Person = { id: slug(d.name), name: d.name, role: 'director', segment: d.segment, managerId: cro.id, quota: 0, title: d.title }
    people.push(dir)
    for (const m of MANAGERS.filter((x) => x.segment === d.segment)) {
      const mgr: Person = { id: slug(m.name), name: m.name, role: 'manager', segment: d.segment, managerId: dir.id, quota: 0, title: m.title }
      people.push(mgr)
      for (const r of m.reps) {
        const rep: Person = {
          id: slug(r.name), name: r.name, role: 'rep', segment: d.segment, managerId: mgr.id, quota: r.quota,
          title: `Account Executive, ${d.segment === 'MM' ? 'Mid-Market' : d.segment === 'ENT' ? 'Enterprise' : 'SMB'}`,
        }
        people.push(rep)
        const rr = rng.fork(rep.id)
        profiles.set(rep.id, {
          landing: sandbaggers.has(r.name) ? 1.12 : Math.min(1.1, Math.max(0.84, rr.normal(0.97, 0.05))),
          opt: rr.range(0.05, 0.14),
          cons: rr.range(0, 0.1),
          aggressive: false,
          sloppy: rr.range(0, 0.12),
          skill: rr.range(0.93, 1.07),
          firstQuarter: 0,
          ...r.profile,
        })
        mgr.quota += r.quota
        dir.quota += r.quota
        cro.quota += r.quota
      }
    }
  }
  return { org: { people, croId: cro.id, boardPlan: cro.quota }, profiles }
}

// ───────────────────────── Accounts ─────────────────────────

type Cluster = 'high' | 'falling' | 'steady'

function makeCompanyNamer(rng: Rng) {
  const used = new Set<string>()
  return () => {
    for (let i = 0; i < 200; i++) {
      const n = `${rng.pick(COMPANY_PREFIX)} ${rng.pick(COMPANY_SUFFIX)}`
      if (!used.has(n)) {
        used.add(n)
        return n
      }
    }
    const n = `${rng.pick(COMPANY_PREFIX)} ${rng.pick(COMPANY_SUFFIX)} ${used.size}`
    used.add(n)
    return n
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

function buildAccounts(rng: Rng, org: Org, nextName: () => string): { accounts: Account[]; clusters: Map<string, Cluster> } {
  const accounts: Account[] = []
  const clusters = new Map<string, Cluster>()
  const counts: Record<Segment, number> = { SMB: 300, MM: 150, ENT: 70 }
  for (const seg of ['SMB', 'MM', 'ENT'] as Segment[]) {
    const reps = org.people.filter((p) => p.role === 'rep' && p.segment === seg)
    for (let i = 0; i < counts[seg]; i++) {
      const ar = rng.fork(`acct-${seg}-${i}`)
      let tier: Tier
      let seats: number
      let arr: number
      if (seg === 'SMB') {
        if (ar.chance(0.3)) {
          tier = 'Pro'
          seats = ar.int(1, 6)
          arr = seats * 300 * ar.int(2, 8)
        } else {
          tier = 'Teams'
          seats = ar.int(8, 60)
          arr = seats * 600
        }
      } else if (seg === 'MM') {
        tier = ar.chance(0.25) ? 'Enterprise' : 'Teams'
        seats = ar.int(40, 220)
        arr = Math.round(seats * (tier === 'Teams' ? 600 : 780) * ar.range(0.8, 1.2))
      } else {
        tier = 'Enterprise'
        seats = ar.int(250, 1200)
        arr = Math.round(seats * ar.range(600, 800))
      }
      const cluster: Cluster = ar.weighted(['high', 'falling', 'steady'] as Cluster[], [0.25, 0.1, 0.65])
      const util: number[] = []
      if (cluster === 'high') {
        const b = ar.range(0.86, 1.06)
        for (let m = 0; m < 6; m++) util.push(round2(clamp(b + ar.normal(0, 0.04) + (m < 2 ? -0.03 : 0), 0.82, 1.25)))
      } else if (cluster === 'falling') {
        const start = ar.range(0.78, 0.95)
        const end = ar.range(0.2, 0.45)
        for (let m = 0; m < 6; m++) util.push(round2(clamp(start + ((end - start) * m) / 5 + ar.normal(0, 0.03), 0.05, 1)))
      } else {
        const b = ar.range(0.6, 0.85)
        for (let m = 0; m < 6; m++) util.push(round2(clamp(b + ar.normal(0, 0.05), 0.3, 0.79)))
      }
      const id = `acct-${seg.toLowerCase()}-${String(i + 1).padStart(3, '0')}`
      const perSeat = tier === 'Enterprise' ? 150 : 100
      accounts.push({
        id,
        name: nextName(),
        segment: seg,
        ownerId: reps[i % reps.length].id,
        tier,
        seats,
        arr,
        creditsIncluded: seats * perSeat,
        creditUtilisation: util,
      })
      clusters.set(id, cluster)
    }
  }
  return { accounts, clusters }
}

const round2 = (x: number) => Math.round(x * 100) / 100

// ───────────────────────── Deal scripts ─────────────────────────

type Fate = 'won' | 'lost' | 'stall'

interface CloseEvent { day: number; closeDay: number; kind: 'push' | 'pull' }

interface Script {
  id: string
  ownerId: string
  segment: Segment
  type: DealType
  accountId: string
  accountName: string
  name: string
  createdDay: number
  entry: number[]
  fate: Fate
  endDay: number
  amount0: number
  amountEvents: { day: number; factor: number }[]
  q0: number
  drift: number
  ebDay: number
  planDay: number
  quiet: { from: number; to: number }[]
  closeDay0: number
  closeEvents: CloseEvent[]
  u: number
  v: number
  actPhase: number
  locked?: boolean
}

interface QuarterCtx {
  def: QuarterDef
  qEndDay: number
  weeks: number
  rng: Rng
  nextName: () => string
}

function dayOfWeekEnd(week: number, qEndDay: number): number {
  return week >= 13 ? qEndDay : 7 * week - 1
}

function pickAccount(rng: Rng, accounts: Account[], clusters: Map<string, Cluster>, ownerId: string): Account {
  const mine = accounts.filter((a) => a.ownerId === ownerId)
  const w = mine.map((a) => (clusters.get(a.id) === 'high' ? 3 : clusters.get(a.id) === 'falling' ? 0.4 : 1))
  return rng.weighted(mine, w)
}

function makeScript(
  rng: Rng, ctx: QuarterCtx, rep: Person, profile: RepProfile, type: DealType, seq: number,
  accounts: Account[], clusters: Map<string, Cluster>, extra = false,
): Script | null {
  const seg = rep.segment as Segment
  const P = SEG[seg]
  const cyc = P.cycle.map((c) => c * CYCLE_SCALE[seg])
  const cycleTotal = cyc.reduce((a, b) => a + b, 0)
  const { qEndDay } = ctx
  for (let attempt = 0; attempt < 40; attempt++) {
    const createdDay = extra ? Math.floor(rng.range(-20, qEndDay - 2)) : rng.chance(PRE_SHARE[seg]) ? -Math.floor(rng.range(1, cycleTotal * 0.9)) : Math.floor(rng.range(0, qEndDay - 2))
    const q0 = clamp(rng.normal(62, 13), 8, 97)
    const pWin = clamp(P.pWin * profile.skill * Math.exp(0.035 * (q0 - 62)), 0.03, 0.9)
    const fate: Fate = extra ? 'stall' : rng.next() < pWin ? 'won' : rng.chance(P.stall) ? 'stall' : 'lost'
    const speed = extra ? rng.range(2.0, 3.2) : fate === 'won' ? rng.range(0.8, 1.15) : fate === 'lost' ? rng.range(0.8, 1.4) : rng.range(1.6, 2.8)
    const dur = cyc.map((c) => Math.max(1, Math.round(c * rng.logNormal(0, 0.3) * speed)))
    const entry = [createdDay]
    for (let i = 0; i < 5; i++) entry.push(entry[i] + dur[i])
    let endDay = Infinity
    if (fate === 'won') endDay = entry[5] + dur[5]
    else if (fate === 'lost') {
      const L = rng.weighted([0, 1, 2, 3, 4, 5], [0.15, 0.25, 0.25, 0.15, 0.12, 0.08])
      endDay = entry[L] + Math.max(1, Math.round(dur[L] * rng.range(0.3, 1.2)))
    }
    if (endDay < 0) continue

    let account: Account | undefined
    let accountId: string
    let accountName: string
    let amount: number
    if (type === 'Expansion') {
      account = pickAccount(rng, accounts, clusters, rep.id)
      accountId = account.id
      accountName = account.name
      amount = account.arr * P.expShare * rng.logNormal(-0.08, 0.4)
    } else {
      accountId = `prospect-${ctx.def.id}-${rep.id}-${seq}`
      accountName = ctx.nextName()
      amount = P.avgNew * rng.logNormal(-0.1, 0.45)
    }
    amount = Math.max(P.round, Math.round(amount / P.round) * P.round)

    // Close-date story
    const plannedEnd = fate === 'won' ? endDay : createdDay + cycleTotal * (fate === 'stall' ? 1.1 : 1.0)
    let closeDay0 = Math.round((fate === 'won' ? endDay : plannedEnd) + rng.normal(5, 12))
    closeDay0 = Math.max(closeDay0, createdDay + 7)
    if (extra) closeDay0 = Math.max(createdDay + 7, rng.int(14, qEndDay))
    const closeEvents: CloseEvent[] = []
    const pullIn = fate === 'won' && endDay <= qEndDay && endDay >= 6 && rng.chance(0.12)
    if (pullIn) {
      closeDay0 = qEndDay + rng.int(5, 40)
      const day = Math.max(createdDay + 1, endDay - rng.int(6, 14))
      closeEvents.push({ day, closeDay: Math.min(qEndDay, endDay + rng.int(0, 3)), kind: 'pull' })
    } else {
      let cur = closeDay0
      for (let k = 0; k < 5; k++) {
        const resolved = fate !== 'stall' && endDay <= cur
        if (resolved) break
        if (fate === 'stall' && cur > qEndDay + 45) break
        if (fate !== 'stall' && k >= 4) break
        const next = fate === 'won' ? Math.max(cur + 7, endDay + rng.int(-4, 10))
          : fate === 'lost' ? Math.max(cur + 7, endDay + rng.int(-4, 6))
          : cur + rng.int(10, 32)
        const pushDay = Math.max(createdDay + 1, cur - rng.int(0, 5))
        if (fate !== 'stall' && pushDay >= endDay) break
        closeEvents.push({ day: pushDay, closeDay: next, kind: 'push' })
        cur = next
      }
    }

    const amountEvents: Script['amountEvents'] = []
    if (rng.chance(0.2)) {
      const hi = Math.min(endDay, qEndDay)
      const n = rng.chance(0.3) ? 2 : 1
      for (let i = 0; i < n; i++) {
        if (hi > createdDay + 2) {
          amountEvents.push({ day: rng.int(createdDay + 1, Math.floor(hi)), factor: clamp(rng.logNormal(0, 0.15), 0.75, 1.3) })
        }
      }
      amountEvents.sort((a, b) => a.day - b.day)
    }

    const sloppy = profile.sloppy
    const never = (p: number) => rng.chance(p + sloppy)
    const ebDay = fate === 'won'
      ? (never(0.04) ? Infinity : Math.max(createdDay, entry[2] + rng.int(-6, 8)))
      : (never(0.3) ? Infinity : entry[3] + rng.int(0, 30))
    const planDay = fate === 'won'
      ? (never(0.05) ? Infinity : entry[4] + rng.int(-8, 4))
      : (never(0.4) ? Infinity : entry[4] + rng.int(0, 25))
    const quiet: Script['quiet'] = []
    if (rng.chance(fate === 'won' ? 0.1 : 0.45)) {
      const from = Math.round(rng.range(Math.max(createdDay + 8, 0), Math.max(createdDay + 9, qEndDay)))
      quiet.push({ from, to: from + rng.int(fate === 'won' ? 10 : 14, 40) })
    }

    return {
      id: `${ctx.def.id}-${rep.id}-${type === 'New' ? 'n' : 'x'}${seq}`,
      ownerId: rep.id, segment: seg, type, accountId, accountName,
      name: dealName(rng, seg, type),
      createdDay, entry, fate, endDay, amount0: amount, amountEvents, q0,
      drift: fate === 'won' ? 0.12 : fate === 'lost' ? -0.1 : -0.03,
      ebDay, planDay, quiet, closeDay0, closeEvents,
      u: rng.next(), v: rng.next(), actPhase: rng.int(0, 7),
    }
  }
  return null
}

function isOpen(d: Deal): boolean {
  return d.stage !== 'Closed Won' && d.stage !== 'Closed Lost'
}

function dealName(rng: Rng, seg: Segment, type: DealType): string {
  if (type === 'Expansion') return rng.pick(seg === 'SMB' ? ['Seat expansion', 'Annual upgrade', 'Credit top-up pack'] : ['Seat expansion', 'Credit pool upsize', 'Add-on workspace'])
  return rng.pick(seg === 'SMB' ? ['Teams plan', 'Teams, annual'] : seg === 'MM' ? ['Teams rollout', 'Department rollout'] : ['Enterprise platform', 'Enterprise, pooled credits'])
}

// ───────────────────────── Snapshotting a script ─────────────────────────

function dateOf(ctx: QuarterCtx, day: number): string {
  return addDays(ctx.def.start, day)
}

function categoryFor(s: Script, stageIdx: number, D: number, closeDay: number, pushes: number, quality: number, qEndDay: number, profile: RepProfile): ForecastCategory {
  const inQ = closeDay <= qEndDay && closeDay >= 0
  if (!inQ) return quality < 35 && stageIdx <= 1 && s.v > 0.5 ? 'Omitted' : 'Pipeline'
  let rank: number
  if (stageIdx <= 1) rank = 0
  else if (stageIdx === 2) rank = quality >= 60 && closeDay - D <= 28 ? 1 : 0
  else if (stageIdx === 3) rank = quality >= 62 ? 2 : quality >= 48 && closeDay - D <= 42 ? 1 : 0
  else if (stageIdx === 4) rank = quality >= 30 ? 2 : 1
  else rank = 2
  if (s.u < profile.opt) rank += profile.aggressive && s.u < profile.opt * 0.4 ? 2 : 1
  if (s.v < profile.cons) rank -= 1
  if (pushes >= 2 && !profile.aggressive && s.v > 0.4) rank -= 1
  return rank <= 0 ? 'Pipeline' : rank === 1 ? 'Best Case' : 'Commit'
}

function dealAt(s: Script, D: number, week: number, ctx: QuarterCtx, profile: RepProfile): Deal | null {
  if (s.createdDay > D) return null
  if (s.fate === 'lost' && D >= s.endDay + 7) return null
  if (s.endDay < 0) return null
  // amount
  let amount = s.amount0
  for (const e of s.amountEvents) if (e.day <= D) amount *= e.factor
  amount = Math.max(SEG[s.segment].round, Math.round(amount / SEG[s.segment].round) * SEG[s.segment].round)

  const won = s.fate === 'won' && s.endDay <= D
  const lost = s.fate === 'lost' && s.endDay <= D
  let stageIdx = 0
  for (let i = 0; i < 6; i++) if (s.entry[i] <= D) stageIdx = i
  const stage: Stage = won ? 'Closed Won' : lost ? 'Closed Lost' : STAGES[stageIdx]

  let closeDay = s.closeDay0
  let pushes = 0
  for (const e of s.closeEvents) {
    if (e.day <= D) {
      closeDay = e.closeDay
      if (e.kind === 'push') pushes++
    }
  }
  if (won) closeDay = s.endDay

  const quality = Math.round(clamp(s.q0 + (Math.min(D, s.endDay) - s.createdDay) * s.drift, 5, 98))
  let lastActivity: number
  if (won || lost) lastActivity = s.endDay
  else {
    lastActivity = D - ((s.actPhase + week * 5) % 8)
    for (const w of s.quiet) if (D >= w.from && D < w.to) lastActivity = Math.min(lastActivity, w.from - 1)
    lastActivity = Math.max(lastActivity, s.createdDay)
  }
  const category: ForecastCategory = won ? 'Closed Won' : lost ? 'Omitted' : categoryFor(s, stageIdx, D, closeDay, pushes, quality, ctx.qEndDay, profile)
  return {
    id: s.id,
    accountId: s.accountId,
    accountName: s.accountName,
    name: s.name,
    ownerId: s.ownerId,
    segment: s.segment,
    type: s.type,
    amount,
    stage,
    category,
    closeDate: dateOf(ctx, closeDay),
    createdDate: dateOf(ctx, s.createdDay),
    economicBuyerIdentified: s.ebDay <= D,
    mutualClosePlan: s.planDay <= D,
    lastActivityDate: dateOf(ctx, lastActivity),
    closeDatePushes: pushes,
    qualityScore: quality,
  }
}

// ───────────────────────── Churn ─────────────────────────

interface ChurnScript {
  accountId: string
  segment: Segment
  ownerId: string
  arr: number
  p: number
  kind: 'churn' | 'downgrade'
  reason: ChurnItem['reason']
  /** Visible as an unrealised risk from this day; Infinity for unflagged. */
  flagDay: number
  /** Day it happens; Infinity if it never does. */
  eventDay: number
}

function makeChurn(rng: Rng, ctx: QuarterCtx, accounts: Account[], clusters: Map<string, Cluster>, scale: number): ChurnScript[] {
  const out: ChurnScript[] = []
  for (const seg of ['SMB', 'MM', 'ENT'] as Segment[]) {
    const P = SEG[seg]
    const target = P.churnTarget * scale * rng.logNormal(0, 0.12)
    const segAccounts = accounts.filter((a) => a.segment === seg)
    const falling = segAccounts.filter((a) => clusters.get(a.id) === 'falling')
    const mk = (flagged: boolean): ChurnScript => {
      const falls = flagged && rng.chance(0.6) && falling.length > 0
      const acct = falls ? rng.pick(falling) : rng.pick(segAccounts)
      const isChurn = rng.chance(seg === 'ENT' ? 0.05 : 0.5)
      const arr = isChurn
        ? acct.arr * (seg === 'SMB' ? 1 : rng.range(0.5, 1))
        : acct.arr * rng.range(0.12, 0.4)
      const reason: ChurnItem['reason'] = falls ? 'falling-usage' : flagged ? rng.pick(['renewal-risk', 'renewal-risk', 'payment-failed'] as const) : rng.pick(['renewal-risk', 'payment-failed', 'falling-usage'] as const)
      return {
        accountId: acct.id, segment: seg, ownerId: acct.ownerId,
        arr: Math.round(arr / 100) * 100, p: 0, kind: isChurn ? 'churn' : 'downgrade', reason,
        flagDay: Infinity, eventDay: Infinity,
      }
    }
    const avg = P.churnAvg
    const nFlagged = Math.max(2, Math.round((0.55 * target) / (0.45 * avg)))
    for (let i = 0; i < nFlagged; i++) {
      const c = mk(true)
      c.p = round2(rng.range(0.2, 0.7))
      c.flagDay = Math.round(rng.range(-30, ctx.qEndDay * 0.6))
      if (rng.chance(c.p)) c.eventDay = Math.round(rng.range(Math.max(0, c.flagDay + 3), ctx.qEndDay))
      out.push(c)
    }
    const nUnflagged = Math.max(2, Math.round((0.45 * target) / avg))
    for (let i = 0; i < nUnflagged; i++) {
      const c = mk(false)
      c.eventDay = Math.round(rng.range(0, ctx.qEndDay))
      out.push(c)
    }
  }
  return out
}

function churnAt(scripts: ChurnScript[], D: number): ChurnItem[] {
  const out: ChurnItem[] = []
  for (const c of scripts) {
    const base = { accountId: c.accountId, segment: c.segment, ownerId: c.ownerId, arrAtRisk: c.arr, kind: c.kind, reason: c.reason }
    if (c.eventDay <= D) out.push({ ...base, probability: 1, realised: true })
    else if (c.flagDay <= D) out.push({ ...base, probability: c.p, realised: false })
  }
  return out
}

// ───────────────────────── Self-serve funnel ─────────────────────────

function makeFunnel(rng: Rng, scale: number, qEndDay: number, weeks: number): SmbFunnel[] {
  const arpa = 950 * rng.range(0.97, 1.03)
  const conv = 0.034 * Math.exp(rng.normal(0, 0.06))
  const totalConv = (SELF_SERVE_TARGET * scale * rng.logNormal(0, 0.05)) / arpa
  const base = totalConv / conv / 13
  void qEndDay
  const out: SmbFunnel[] = []
  let trials = 0
  let paid = 0
  let arr = 0
  for (let w = 1; w <= weeks; w++) {
    const t = base * (1 + 0.012 * (w - 7)) * Math.exp(rng.normal(0, 0.05))
    const c = Math.round(t * conv * Math.exp(rng.normal(0, 0.06)))
    trials += Math.round(t)
    paid += c
    arr += Math.round(c * arpa * Math.exp(rng.normal(0, 0.03)))
    out.push({ trialsStarted: trials, paidConversions: paid, selfServeArr: arr })
  }
  return out
}

// ───────────────────────── Prototype alignment (Priya Raman's team, current quarter) ─────────────────────────

/** Week-6 targets (net ARR) taken from the approved Manager prototype. */
const PRIYA_TARGETS: Record<string, { closed: number; commit: number }> = {
  'marcus-lee': { closed: 60_000, commit: 210_000 },
  'ana-souza': { closed: 70_000, commit: 205_000 },
  'tom-becker': { closed: 55_000, commit: 150_000 },
  'grace-kim': { closed: 70_000, commit: 190_000 },
  'diego-ruiz': { closed: 28_000, commit: 85_000 },
}

/** Non-commit open deals of Priya's reps are scaled by this (a thin, commit-heavy team, as in the prototype). */
const OTHER_OPEN_SCALE = 0.5
/** ARR of extra early-stage pipeline added per Priya rep. */
const PRIYA_PIPELINE_PAD = 230_000

interface ForcedSpec {
  key: string
  ownerId: string
  account: string
  amount: number
  stageIdx: number
  closeDay: number
  pushes: number
  noEB?: boolean
  noPlan?: boolean
  quietFrom?: number
  u: number
}

/** The four Commit deals that break a commit rule in the prototype ($123k in total). */
const FORCED: ForcedSpec[] = [
  { key: 'northwind', ownerId: 'ana-souza', account: 'Northwind Logistics', amount: 48_000, stageIdx: 4, closeDay: 72, pushes: 2, noEB: true, u: 0.99 },
  { key: 'kestrel', ownerId: 'tom-becker', account: 'Kestrel Media', amount: 35_000, stageIdx: 3, closeDay: 65, pushes: 0, u: 0.001 },
  { key: 'brightlane', ownerId: 'ana-souza', account: 'Brightlane Health', amount: 22_000, stageIdx: 5, closeDay: 58, pushes: 0, quietFrom: 23, u: 0.99 },
  { key: 'orbit', ownerId: 'diego-ruiz', account: 'Orbit Labs', amount: 18_000, stageIdx: 4, closeDay: 79, pushes: 0, noPlan: true, u: 0.99 },
]

function forcedScript(ctx: QuarterCtx, f: ForcedSpec): Script {
  const D6 = dayOfWeekEnd(CURRENT_WEEK, ctx.qEndDay)
  const entry: number[] = []
  for (let i = 0; i < 6; i++) entry.push(i <= f.stageIdx ? D6 - (f.stageIdx - i) * 9 - 3 : D6 + (i - f.stageIdx) * 10)
  const closeDay0 = f.closeDay - 14 * f.pushes
  const closeEvents: CloseEvent[] = []
  for (let k = 0; k < f.pushes; k++) closeEvents.push({ day: 8 + k * 14, closeDay: closeDay0 + 14 * (k + 1), kind: 'push' })
  return {
    id: `${ctx.def.id}-${f.ownerId}-forced-${f.key}`, ownerId: f.ownerId, segment: 'MM', type: 'New',
    accountId: `prospect-${f.key}`, accountName: f.account, name: 'Teams rollout',
    createdDay: entry[0], entry, fate: 'stall', endDay: Infinity, amount0: f.amount, amountEvents: [],
    q0: 62, drift: -0.02, ebDay: f.noEB ? Infinity : entry[2], planDay: f.noPlan ? Infinity : entry[3],
    quiet: f.quietFrom ? [{ from: f.quietFrom, to: 90 }] : [], closeDay0, closeEvents,
    u: f.u, v: 1, actPhase: 2, locked: true,
  }
}

/**
 * Nudges Priya Raman's five reps so their week-6 numbers land on the approved prototype
 * (closed ~ $283k, commit sum ~ $840k, four risky commits worth $123k). Everything else is untouched.
 */
function alignPriyaTeam(
  rng: Rng, ctx: QuarterCtx, scripts: Script[], churn: ChurnScript[], profiles: Map<string, RepProfile>,
  reps: Person[], accounts: Account[], clusters: Map<string, Cluster>,
): void {
  const D6 = dayOfWeekEnd(CURRENT_WEEK, ctx.qEndDay)
  const qStartStr = ctx.def.start
  const elig = { asOf: addDays(qStartStr, D6), quarterStart: qStartStr, quarterEnd: ctx.def.end }
  for (const f of FORCED) scripts.push(forcedScript(ctx, f))
  for (const [id, t] of Object.entries(PRIYA_TARGETS)) {
    const rep = reps.find((r) => r.id === id)
    if (!rep) continue
    const profile = profiles.get(id)!
    for (const c of churn) if (c.ownerId === id) c.arr = Math.round((c.arr * 0.3) / 100) * 100
    const mine = () => scripts.filter((s) => s.ownerId === id)
    const view = (s: Script) => dealAt(s, D6, CURRENT_WEEK, ctx, profile)
    // Repair non-locked Commit deals so only the four forced ones fail the rules.
    for (const s of mine()) {
      if (s.locked) continue
      for (let pass = 0; pass < 3; pass++) {
        const d = view(s)
        if (!d || d.category !== 'Commit' || d.stage === 'Closed Won') break
        const res = checkEligibility(d, elig)
        if (res.eligible) break
        for (const r of res.failedRules) {
          if (r.id === 'economic-buyer') s.ebDay = s.createdDay
          else if (r.id === 'close-plan') s.planDay = s.createdDay
          else if (r.id === 'recent-activity') s.quiet = []
          else if (r.id === 'push-limit') s.closeEvents = s.closeEvents.slice(0, 1)
          else if (r.id === 'late-stage') {
            s.q0 = 30
            s.u = 1
            s.v = 1
          }
        }
      }
    }
    // Make sure there is something to scale: top up with won / commit deals if the rep has too few.
    const wonSum = () => mine().reduce((a, s) => (s.fate === 'won' && s.endDay <= D6 && s.endDay >= 0 ? a + s.amount0 : a), 0)
    const commitSum = () => mine().reduce((a, s) => {
      const d = view(s)
      return d && d.category === 'Commit' && d.stage !== 'Closed Won' && d.stage !== 'Closed Lost' && d.closeDate <= ctx.def.end && !s.locked ? a + d.amount : a
    }, 0)
    let seq = 1000
    for (let tries = 0; tries < 400 && wonSum() < t.closed * 0.6; tries++) {
      const s = makeScript(rng, ctx, rep, profile, rng.chance(0.5) ? 'New' : 'Expansion', seq++, accounts, clusters)
      if (s && s.fate === 'won' && s.endDay >= 2 && s.endDay <= D6) scripts.push(s)
    }
    for (let tries = 0; tries < 800 && commitSum() < t.commit * 0.5; tries++) {
      const s = makeScript(rng, ctx, rep, profile, rng.chance(0.5) ? 'New' : 'Expansion', seq++, accounts, clusters)
      const d = s && view(s)
      if (s && d && d.category === 'Commit' && d.stage !== 'Closed Won' && d.stage !== 'Closed Lost' && d.closeDate <= ctx.def.end && checkEligibility(d, elig).eligible) scripts.push(s)
    }
    // Scale amounts to hit the targets.
    const real = churn.filter((c) => c.ownerId === id && c.eventDay <= D6).reduce((a, c) => a + c.arr, 0)
    const exp = churn.filter((c) => c.ownerId === id && c.eventDay > D6 && c.flagDay <= D6).reduce((a, c) => a + c.arr * c.p, 0)
    const won = wonSum()
    const sC = won > 0 ? (t.closed + real) / won : 1
    const locked = mine().filter((s) => s.locked).reduce((a, s) => {
      const d = view(s)
      return d ? a + d.amount : a
    }, 0)
    const cm = commitSum()
    const sO = cm > 0 ? (t.commit - t.closed + 1.25 * exp - locked) / cm : 1
    for (const s of mine()) {
      if (s.locked) continue
      if (s.fate === 'won' && s.endDay <= D6) s.amount0 *= sC
      else {
        const d = view(s)
        if (d && d.category === 'Commit' && d.stage !== 'Closed Lost') s.amount0 *= Math.max(0.2, sO)
        else if (d && d.stage !== 'Closed Lost') s.amount0 *= OTHER_OPEN_SCALE
      }
    }
    // Early-stage pipeline that will not close this quarter, so coverage stays near 3x despite the thin commit book.
    let padded = 0
    for (let tries = 0; tries < 400 && padded < PRIYA_PIPELINE_PAD; tries++) {
      const s = makeScript(rng, ctx, rep, profile, rng.chance(0.6) ? 'New' : 'Expansion', seq++, accounts, clusters, true)
      const d = s && view(s)
      if (s && d && d.category === 'Pipeline' && isOpen(d) && d.closeDate <= ctx.def.end) {
        scripts.push(s)
        padded += d.amount
      }
    }
  }
}

// ───────────────────────── Quarter assembly ─────────────────────────

function stochRound(rng: Rng, x: number): number {
  const f = Math.floor(x)
  return f + (rng.next() < x - f ? 1 : 0)
}

function buildQuarter(
  rng: Rng, def: QuarterDef, qi: number, isCurrent: boolean, org: Org, profiles: Map<string, RepProfile>,
  accounts: Account[], clusters: Map<string, Cluster>, nextName: () => string,
): Quarter {
  const weeks = isCurrent ? CURRENT_WEEK : 13
  const qEndDay = Math.round((Date.UTC(+def.end.slice(0, 4), +def.end.slice(5, 7) - 1, +def.end.slice(8)) - Date.UTC(+def.start.slice(0, 4), +def.start.slice(5, 7) - 1, +def.start.slice(8))) / 86400000)
  const ctx: QuarterCtx = { def, qEndDay, weeks, rng, nextName }
  const plan = {} as Record<Segment, number>
  for (const s of ['SMB', 'MM', 'ENT'] as Segment[]) plan[s] = Math.round((SEGMENT_PLAN[s] * def.scale) / 1000) * 1000

  const funnels = makeFunnel(rng.fork('funnel'), def.scale, qEndDay, weeks)
  const segAtt: Record<Segment, number> = {
    SMB: ATTAINMENT * rng.logNormal(0, 0.04), MM: ATTAINMENT * rng.logNormal(0, 0.04), ENT: ATTAINMENT * rng.logNormal(0, 0.06),
  }

  const reps = org.people.filter((p) => p.role === 'rep' && profiles.get(p.id)!.firstQuarter <= qi)
  const scripts: Script[] = []
  const segReps = (s: Segment) => reps.filter((r) => r.segment === s)
  for (const rep of reps) {
    const seg = rep.segment as Segment
    const P = SEG[seg]
    const profile = profiles.get(rep.id)!
    const rr = rng.fork(`deals-${rep.id}`)
    const quota = rep.quota * def.scale
    const churnShare = (P.churnTarget * def.scale) / segReps(seg).length
    const ssShare = seg === 'SMB' ? (SELF_SERVE_TARGET * def.scale) / segReps('SMB').length : 0
    const gross = Math.max(quota * 0.2, segAtt[seg] * quota + churnShare - ssShare) * (def.volume ?? 1)
    const gNew = gross * P.newShare
    const gExp = gross - gNew
    // average expansion deal size ~ account arr * expShare (mean of owned accounts)
    const mine = accounts.filter((a) => a.ownerId === rep.id)
    const avgExp = (mine.reduce((a, b) => a + b.arr, 0) / Math.max(1, mine.length)) * P.expShare
    const nNew = stochRound(rr, gNew / (P.avgNew * P.fracWin))
    const nExp = stochRound(rr, gExp / (avgExp * P.fracWin))
    for (let i = 0; i < nNew; i++) {
      const s = makeScript(rr, ctx, rep, profile, 'New', i, accounts, clusters)
      if (s) scripts.push(s)
    }
    for (let i = 0; i < nExp; i++) {
      const s = makeScript(rr, ctx, rep, profile, 'Expansion', i, accounts, clusters)
      if (s) scripts.push(s)
    }
    // Slow-moving pipeline that will not close this quarter (what makes coverage ratios realistic).
    const nExtra = stochRound(rr, (nNew + nExp) * EXTRA_PIPELINE[seg])
    for (let i = 0; i < nExtra; i++) {
      const type: DealType = rr.chance(P.newShare) ? 'New' : 'Expansion'
      const s = makeScript(rr, ctx, rep, profile, type, 500 + i, accounts, clusters, true)
      if (s) scripts.push(s)
    }
  }
  const churnScripts = makeChurn(rng.fork('churn'), ctx, accounts, clusters, def.scale * (def.churn ?? 1))
  if (isCurrent) alignPriyaTeam(rng.fork('priya-align'), ctx, scripts, churnScripts, profiles, reps, accounts, clusters)

  const snapshots: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w++) {
    const D = dayOfWeekEnd(w, qEndDay)
    const deals: Deal[] = []
    for (const s of scripts) {
      const d = dealAt(s, D, w, ctx, profiles.get(s.ownerId)!)
      if (d) deals.push(d)
    }
    snapshots.push({ week: w, asOf: addDays(def.start, D), deals, churn: churnAt(churnScripts, D), smbFunnel: funnels[w - 1] })
  }

  return {
    id: def.id, label: def.label, start: def.start, end: def.end, isCurrent, weeksElapsed: weeks, plan,
    startingArr: 0, snapshots, calls: [],
  }
}

export function computeActuals(org: Org, q: Quarter): QuarterActuals {
  const final = q.snapshots[q.snapshots.length - 1]
  const reps = org.people.filter((p) => p.role === 'rep')
  const smbRepCount = reps.filter((r) => r.segment === 'SMB').length
  const byPerson: Record<string, number> = {}
  let newArr = final.smbFunnel.selfServeArr
  let expansionArr = 0
  let churnArr = 0
  const bySegment: Record<Segment, number> = { SMB: final.smbFunnel.selfServeArr, MM: 0, ENT: 0 }
  for (const r of reps) byPerson[r.id] = r.segment === 'SMB' ? final.smbFunnel.selfServeArr / smbRepCount : 0
  for (const d of final.deals) {
    if (d.stage !== 'Closed Won') continue
    if (d.type === 'New') newArr += d.amount
    else expansionArr += d.amount
    bySegment[d.segment] += d.amount
    byPerson[d.ownerId] = (byPerson[d.ownerId] ?? 0) + d.amount
  }
  for (const c of final.churn) {
    if (!c.realised) continue
    churnArr += c.arrAtRisk
    bySegment[c.segment] -= c.arrAtRisk
    byPerson[c.ownerId] = (byPerson[c.ownerId] ?? 0) - c.arrAtRisk
  }
  // roll up managers, directors, CRO
  const children = new Map<string, Person[]>()
  for (const p of org.people) if (p.managerId) children.set(p.managerId, [...(children.get(p.managerId) ?? []), p])
  const roll = (p: Person): number => {
    if (p.role === 'rep') return byPerson[p.id] ?? 0
    const v = (children.get(p.id) ?? []).reduce((a, c) => a + roll(c), 0)
    byPerson[p.id] = v
    return v
  }
  roll(org.people.find((p) => p.id === org.croId)!)
  return { newArr, expansionArr, churnArr, netNewArr: newArr + expansionArr - churnArr, bySegment, byPerson }
}

// ───────────────────────── Entry point ─────────────────────────

export function generateDataset(seed = 42): Dataset {
  const rng = createRng(seed)
  const nextName = makeCompanyNamer(rng.fork('names'))
  const { org, profiles } = buildOrg(rng.fork('org'))
  const { accounts, clusters } = buildAccounts(rng.fork('accounts'), org, nextName)

  const quarters: Quarter[] = QUARTER_DEFS.map((def, qi) =>
    buildQuarter(rng.fork(`quarter-${qi}`), def, qi, qi === QUARTER_DEFS.length - 1, org, profiles, accounts, clusters, nextName),
  )
  for (const q of quarters) if (!q.isCurrent) q.actuals = computeActuals(org, q)

  // Starting ARR: walk back from $120.0M at the start of the current quarter.
  let start = 120_000_000
  quarters[quarters.length - 1].startingArr = start
  for (let i = quarters.length - 2; i >= 0; i--) {
    start -= quarters[i].actuals!.netNewArr
    quarters[i].startingArr = Math.round(start)
  }

  const ds: Dataset = { seed, company: 'Shipwright', org, accounts, quarters, currentWeek: CURRENT_WEEK }
  seedCalls(ds, rng.fork('calls'), profiles)
  return ds
}

export { SEG as SEGMENT_PARAMS }
