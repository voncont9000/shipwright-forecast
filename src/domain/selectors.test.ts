import { describe, expect, it } from 'vitest'
import { api } from './selectors'
import type { Call, ViewInput } from './types'

const ds = api.loadDataset(42)
const input: ViewInput = { week: 6, userCalls: [] }
const within = (actual: number, target: number, tol: number) => Math.abs(actual - target) / target <= tol

describe('prepareCall', () => {
  const priya = 'priya-raman'
  const sum = api.teamView(ds, input, priya).reportsSum

  it('accepts a call equal to the reports\' sum with no reason', () => {
    const r = api.prepareCall(ds, input, priya, { ...sum })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.call.source).toBe('user')
      expect(r.call.personId).toBe(priya)
      expect(r.call.week).toBe(6)
    }
  })

  it('rejects an override with a missing or blank reason', () => {
    const v = { commit: sum.commit - 50_000, mostLikely: sum.mostLikely, bestCase: sum.bestCase }
    expect(api.prepareCall(ds, input, priya, v).ok).toBe(false)
    expect(api.prepareCall(ds, input, priya, { ...v, reason: '   ' }).ok).toBe(false)
    const ok = api.prepareCall(ds, input, priya, { ...v, reason: 'Two deals stuck in legal' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.call.reason).toBe('Two deals stuck in legal')
  })

  it('treats a change of $1 or less as no change', () => {
    expect(api.prepareCall(ds, input, priya, { commit: sum.commit + 1, mostLikely: sum.mostLikely, bestCase: sum.bestCase }).ok).toBe(true)
    expect(api.prepareCall(ds, input, priya, { commit: sum.commit + 2, mostLikely: sum.mostLikely + 2, bestCase: sum.bestCase + 2 }).ok).toBe(false)
  })

  it('rejects commit above most likely, and most likely above best case', () => {
    const a = api.prepareCall(ds, input, priya, { commit: 900_000, mostLikely: 800_000, bestCase: 1_000_000, reason: 'x' })
    expect(a.ok).toBe(false)
    const b = api.prepareCall(ds, input, priya, { commit: 700_000, mostLikely: 1_100_000, bestCase: 1_000_000, reason: 'x' })
    expect(b.ok).toBe(false)
  })

  it('compares a rep\'s call to their deal pre-fill', () => {
    const rep = api.repView(ds, input, 'marcus-lee')
    expect(api.prepareCall(ds, input, 'marcus-lee', { ...rep.prefill }).ok).toBe(true)
    expect(api.prepareCall(ds, input, 'marcus-lee', { ...rep.prefill, commit: rep.prefill.commit + 5000, mostLikely: rep.prefill.mostLikely + 5000, bestCase: rep.prefill.bestCase + 5000 }).ok).toBe(false)
  })

  it('a submitted manager call flows to the director, CRO and board views', () => {
    const before = api.boardView(ds, input)
    const r = api.prepareCall(ds, input, priya, { commit: sum.commit - 100_000, mostLikely: sum.mostLikely - 120_000, bestCase: sum.bestCase - 150_000, reason: 'Slipping' })
    if (!r.ok) throw new Error(r.error)
    const withCall: ViewInput = { week: 6, userCalls: [r.call as Call] }
    const own = api.teamView(ds, withCall, priya).ownCall!
    expect(own.mostLikely).toBe(sum.mostLikely - 120_000)
    const after = api.boardView(ds, withCall)
    expect(after.call.mostLikely).toBe(before.call.mostLikely + (sum.mostLikely - 120_000) - api.teamView(ds, input, priya).ownCall!.mostLikely)
    expect(api.croView(ds, withCall).chain[1].reasons.some((x) => x.personName === 'Priya Raman')).toBe(true)
  })
})

describe('deadlines and weeks', () => {
  it('has the weekly cadence', () => {
    expect(api.deadlineFor('rep')).toBe('Monday 17:00')
    expect(api.deadlineFor('manager')).toBe('Tuesday 17:00')
    expect(api.deadlineFor('director')).toBe('Wednesday 17:00')
    expect(api.deadlineFor('cro')).toBe('Thursday 12:00')
    expect(api.maxWeek(ds)).toBe(6)
  })

  it('moves through the weeks', () => {
    const w1 = api.croView(ds, { week: 1, userCalls: [] })
    const w6 = api.croView(ds, { week: 6, userCalls: [] })
    expect(w1.week).toBe(1)
    expect(w6.week).toBe(6)
    expect(w1.ownCall!.mostLikely).not.toBe(w6.ownCall!.mostLikely)
  })
})

describe('calibration targets (week 6, seed 42)', () => {
  const board = api.boardView(ds, input)
  const cro = api.croView(ds, input)
  const priya = api.teamView(ds, input, 'priya-raman')

  it('board plan and segment plans', () => {
    expect(board.plan).toBe(9_000_000)
    const plan = Object.fromEntries(cro.segments.map((s) => [s.segment, s.plan]))
    expect(plan).toEqual({ SMB: 3_600_000, MM: 2_800_000, ENT: 2_600_000 })
  })

  it('CRO call sits just under plan and the model sits close to it', () => {
    expect(within(board.call.mostLikely, 8_600_000, 0.07)).toBe(true)
    expect(board.call.mostLikely / board.plan).toBeGreaterThan(0.94)
    expect(board.call.mostLikely / board.plan).toBeLessThan(0.99)
    expect(within(board.call.commit, 7_750_000, 0.07)).toBe(true)
    expect(within(board.call.bestCase, 9_600_000, 0.07)).toBe(true)
    expect(within(board.model.p50, 8_550_000, 0.07)).toBe(true)
    expect(board.model.p50).toBeLessThan(board.call.mostLikely)
  })

  it('every segment lands slightly under plan', () => {
    for (const s of cro.segments) {
      expect(s.call.mostLikely / s.plan).toBeGreaterThan(0.91)
      expect(s.call.mostLikely / s.plan).toBeLessThan(1.0)
    }
  })

  it('Priya Raman\'s team follows the prototype', () => {
    expect(priya.pathToPlan.plan).toBe(1_200_000)
    expect(within(priya.pathToPlan.closed, 283_000, 0.07)).toBe(true)
    expect(within(priya.reportsSum.commit, 840_000, 0.07)).toBe(true)
    expect(within(priya.model.p50, 812_000, 0.05)).toBe(true)
    expect(priya.atRiskCommits).toHaveLength(4)
    expect(within(priya.atRiskCommits.reduce((a, r) => a + r.deal.amount, 0), 123_000, 0.02)).toBe(true)
    const row = (n: string) => priya.rows.find((r) => r.person.name === n)!
    const commits: Record<string, number> = { 'Marcus Lee': 210_000, 'Ana Souza': 205_000, 'Tom Becker': 150_000, 'Grace Kim': 190_000, 'Diego Ruiz': 85_000 }
    for (const [name, c] of Object.entries(commits)) expect(within(row(name).call.commit, c, 0.07)).toBe(true)
    // model within 10% of commit for everyone except Ana, whose model is clearly below her commit
    for (const name of ['Marcus Lee', 'Tom Becker', 'Grace Kim', 'Diego Ruiz']) {
      expect(within(row(name).model, row(name).call.commit, 0.1)).toBe(true)
      expect(row(name).warning).toBeNull()
    }
    expect(row('Ana Souza').model).toBeLessThan(0.88 * row('Ana Souza').call.commit)
    expect(row('Ana Souza').warning).toMatch(/above model/)
    expect(row('Ana Souza').biasNote).toMatch(/lands at 8\d% of commit/)
    expect(row('Diego Ruiz').biasNote).toBeNull()
  })

  it('the board bridge adds up to the call', () => {
    const b = board.bridge
    expect(b.newArr + b.expansionArr - b.churnArr).toBe(board.call.mostLikely)
    expect(b.endingArr).toBe(b.startingArr + board.call.mostLikely)
    expect(b.startingArr).toBe(120_000_000)
    expect(b.newArr).toBeGreaterThan(4_500_000)
    expect(b.newArr).toBeLessThan(6_500_000)
    expect(b.expansionArr).toBeGreaterThan(3_800_000)
    expect(b.churnArr).toBeGreaterThan(800_000)
    expect(b.churnArr).toBeLessThan(2_200_000)
  })

  it('KPIs are in believable ranges (fractions for %)', () => {
    const k = Object.fromEntries(board.kpis.map((x) => [x.id, x.value]))
    expect(k['nrr']).toBeGreaterThan(1.05)
    expect(k['nrr']).toBeLessThan(1.2)
    expect(k['grr']).toBeGreaterThan(0.86)
    expect(k['grr']).toBeLessThan(0.96)
    expect(k['credit-utilisation']).toBeGreaterThan(0.66)
    expect(k['credit-utilisation']).toBeLessThan(0.82)
    expect(k['coverage']).toBeGreaterThan(2.5)
    expect(k['coverage']).toBeLessThan(3.6)
  })

  it('the CRO call moves gently from week to week', () => {
    const calls = board.trend.filter((p) => p.call !== null).map((p) => p.call as number)
    expect(calls).toHaveLength(6)
    for (let i = 1; i < calls.length; i++) expect(Math.abs(calls[i] / calls[i - 1] - 1)).toBeLessThan(0.045)
  })

  it('week-over-week deal changes are in the tens, not hundreds', () => {
    for (const c of cro.wow.changes) expect(c.dealCount).toBeLessThan(60)
  })

  it('views are fast after first load', () => {
    const t0 = performance.now()
    api.boardView(ds, input)
    api.croView(ds, input)
    api.teamView(ds, input, 'priya-raman')
    api.repView(ds, input, 'ana-souza')
    expect(performance.now() - t0).toBeLessThan(150)
  })
})

describe('data hygiene', () => {
  it('every person has a sensible bias and error; no rep has a negative quarter', () => {
    const v = api.accuracyView(ds)
    for (const p of v.people) {
      expect(p.bias.commitRatio, p.person.name).toBeGreaterThan(0.75)
      expect(p.bias.commitRatio, p.person.name).toBeLessThan(1.15)
      expect(p.mape, p.person.name).toBeLessThan(0.4)
    }
    for (const q of ds.quarters.slice(0, 4)) {
      for (const r of ds.org.people.filter((x) => x.role === 'rep')) {
        if (r.name === 'Diego Ruiz' && q.id < '2026-Q3') continue
        expect(q.actuals!.byPerson[r.id], `${r.name} ${q.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('titles, deal names and accounts read cleanly', () => {
    expect(ds.org.people.filter((p) => p.role === 'rep').every((p) => p.title === 'Account Executive')).toBe(true)
    const snap = ds.quarters[4].snapshots[5]
    for (const d of snap.deals) {
      expect(d.name).toContain(' — ')
      expect(d.accountName).not.toMatch(/\d$/)
      expect(d.name).not.toMatch(/\d$/)
    }
    for (const r of ds.org.people.filter((p) => p.role === 'rep')) {
      const counts = new Map<string, number>()
      for (const d of snap.deals) {
        if (d.ownerId === r.id && d.stage !== 'Closed Won' && d.stage !== 'Closed Lost') counts.set(d.accountId, (counts.get(d.accountId) ?? 0) + 1)
      }
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2)
    }
  })
})

describe('accuracy view', () => {
  it('has per-level curves, people, calibration for all segments', () => {
    const v = api.accuracyView(ds)
    expect(v.byWeek).toHaveLength(4)
    expect(v.byWeek[0].points).toHaveLength(13)
    expect(v.calibration.map((c) => c.segment)).toEqual(['SMB', 'MM', 'ENT'])
    expect(v.calibration[0].rows).toHaveLength(4)
    expect(v.people.length).toBeGreaterThan(20)
  })
})
