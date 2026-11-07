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

describe('calibration targets (week 6, seed 42, generous tolerances)', () => {
  const board = api.boardView(ds, input)
  const cro = api.croView(ds, input)
  const priya = api.teamView(ds, input, 'priya-raman')

  it('board plan and segment plans', () => {
    expect(board.plan).toBe(9_000_000)
    const plan = Object.fromEntries(cro.segments.map((s) => [s.segment, s.plan]))
    expect(plan).toEqual({ SMB: 3_600_000, MM: 2_800_000, ENT: 2_600_000 })
  })

  it('CRO call and model range', () => {
    expect(within(board.call.mostLikely, 8_600_000, 0.12)).toBe(true)
    expect(within(board.call.commit, 7_600_000, 0.12)).toBe(true)
    expect(within(board.call.bestCase, 9_600_000, 0.15)).toBe(true)
    expect(within(board.model.p10, 7_600_000, 0.1)).toBe(true)
    expect(within(board.model.p90, 9_200_000, 0.12)).toBe(true)
  })

  it('Priya Raman\'s team', () => {
    expect(priya.pathToPlan.plan).toBe(1_200_000)
    expect(within(priya.pathToPlan.closed, 283_000, 0.1)).toBe(true)
    expect(within(priya.reportsSum.commit, 840_000, 0.1)).toBe(true)
    expect(within(priya.model.p50, 812_000, 0.15)).toBe(true)
    expect(priya.atRiskCommits).toHaveLength(4)
    expect(within(priya.atRiskCommits.reduce((a, r) => a + r.deal.amount, 0), 123_000, 0.02)).toBe(true)
    const commits = Object.fromEntries(priya.rows.map((r) => [r.person.name, r.call.commit]))
    expect(within(commits['Marcus Lee'], 210_000, 0.1)).toBe(true)
    expect(within(commits['Ana Souza'], 205_000, 0.1)).toBe(true)
    expect(within(commits['Tom Becker'], 150_000, 0.1)).toBe(true)
    expect(within(commits['Grace Kim'], 190_000, 0.1)).toBe(true)
    expect(within(commits['Diego Ruiz'], 85_000, 0.1)).toBe(true)
    const ana = priya.rows.find((r) => r.person.name === 'Ana Souza')!
    expect(ana.biasNote).toMatch(/lands at 8\d% of commit/)
    expect(priya.rows.find((r) => r.person.name === 'Diego Ruiz')!.biasNote).toBeNull()
  })

  it('bridge, KPIs', () => {
    const b = board.bridge
    expect(b.newArr + b.expansionArr - b.churnArr).toBe(board.call.mostLikely)
    expect(b.endingArr).toBe(b.startingArr + board.call.mostLikely)
    expect(b.startingArr).toBe(120_000_000)
    expect(within(b.newArr, 6_100_000, 0.15)).toBe(true)
    expect(within(b.expansionArr, 4_300_000, 0.15)).toBe(true)
    const k = Object.fromEntries(board.kpis.map((x) => [x.id, x.value]))
    expect(k['nrr']).toBeGreaterThan(1.05)
    expect(k['nrr']).toBeLessThan(1.2)
    expect(k['grr']).toBeGreaterThan(0.86)
    expect(k['grr']).toBeLessThan(0.96)
    expect(k['credit-utilisation']).toBeGreaterThan(0.66)
    expect(k['credit-utilisation']).toBeLessThan(0.82)
    expect(k['coverage']).toBeGreaterThan(2.5)
    expect(k['coverage']).toBeLessThan(3.5)
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
