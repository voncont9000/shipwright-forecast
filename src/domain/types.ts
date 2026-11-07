/**
 * Shared contract for the Shipwright forecasting demo.
 *
 * Two layers:
 *  1. RAW DATA: what the seeded generator produces (org, accounts, deals, weekly snapshots, calls).
 *  2. VIEW MODELS: what each screen renders. Selectors in src/domain/selectors.ts turn raw data
 *     plus the user's submitted calls into these. Screens never do forecasting maths themselves.
 *
 * All money is ARR in whole US dollars (not thousands). Format at the edge.
 * Dates are ISO strings 'YYYY-MM-DD'.
 */

// ───────────────────────────── Basics ─────────────────────────────

export type Segment = 'SMB' | 'MM' | 'ENT'
export const SEGMENTS: readonly Segment[] = ['SMB', 'MM', 'ENT']
export const SEGMENT_LABEL: Record<Segment, string> = { SMB: 'SMB', MM: 'Mid-Market', ENT: 'Enterprise' }

export type Role = 'rep' | 'manager' | 'director' | 'cro' | 'board'
export type PersonRole = Exclude<Role, 'board'>

/** Week of quarter, 1..13. */
export type Week = number

export type Tier = 'Free' | 'Pro' | 'Teams' | 'Enterprise'

export type Stage =
  | 'Discovery'
  | 'Qualification'
  | 'Solution'
  | 'Proposal'
  | 'Negotiation'
  | 'Contracting'
  | 'Closed Won'
  | 'Closed Lost'

/** Stages counted as "Negotiation or later" for commit eligibility (open stages only). */
export const LATE_STAGES: readonly Stage[] = ['Negotiation', 'Contracting']

export type ForecastCategory = 'Pipeline' | 'Best Case' | 'Commit' | 'Closed Won' | 'Omitted'

export type DealType = 'New' | 'Expansion'

// ───────────────────────────── Org ─────────────────────────────

export interface Person {
  id: string
  name: string
  role: PersonRole
  /** Every person below the CRO belongs to exactly one segment. CRO has none. */
  segment?: Segment
  /** Parent in the tree. CRO has none. */
  managerId?: string
  /** Net new ARR quota for the current quarter. For managers/directors/CRO this equals the sum of their reports. */
  quota: number
  title: string
}

export interface Org {
  people: Person[]
  croId: string
  /** Board plan for the current quarter = CRO quota. */
  boardPlan: number
}

// ───────────────────────────── Accounts & credits ─────────────────────────────

export interface Account {
  id: string
  name: string
  segment: Segment
  ownerId: string
  tier: Tier
  seats: number
  /** Current recurring revenue from this account. */
  arr: number
  /** Monthly credits included in the plan. */
  creditsIncluded: number
  /** Share of included credits used per month, oldest first, last 6 months. 1.0 = fully used; >1 means top-ups. */
  creditUtilisation: number[]
}

/** Expected or realised loss of ARR on an existing account (churn or downgrade). */
export interface ChurnItem {
  accountId: string
  segment: Segment
  ownerId: string
  arrAtRisk: number
  /** Model probability that this ARR is lost this quarter. */
  probability: number
  kind: 'churn' | 'downgrade'
  /** Set once it has happened. */
  realised: boolean
  reason: 'falling-usage' | 'renewal-risk' | 'payment-failed'
}

// ───────────────────────────── Deals ─────────────────────────────

export interface Deal {
  id: string
  accountId: string
  accountName: string
  name: string
  ownerId: string
  segment: Segment
  type: DealType
  amount: number
  stage: Stage
  /** Set by the rep. */
  category: ForecastCategory
  closeDate: string
  createdDate: string
  economicBuyerIdentified: boolean
  mutualClosePlan: boolean
  lastActivityDate: string
  closeDatePushes: number
  /** 0..100 deal-quality score from the CRM (MEDDICC completeness etc). */
  qualityScore: number
}

// ───────────────────────────── Calls ─────────────────────────────

export interface CallTriple {
  commit: number
  mostLikely: number
  bestCase: number
}

/** One person's submitted forecast for one week. Every level's call is stored; nothing overwrites another level. */
export interface Call extends CallTriple {
  personId: string
  quarterId: string
  week: Week
  /** Required when the call differs from the sum of the person's reports (or, for reps, from their deal pre-fill). */
  reason?: string
  source: 'seed' | 'user'
}

// ───────────────────────────── Time ─────────────────────────────

/** State of the world at the end of one week. */
export interface WeekSnapshot {
  week: Week
  asOf: string
  deals: Deal[]
  churn: ChurnItem[]
  /** SMB self-serve funnel for the quarter so far (cumulative to this week). */
  smbFunnel: SmbFunnel
}

export interface SmbFunnel {
  trialsStarted: number
  paidConversions: number
  /** Net new ARR from self-serve so far this quarter. */
  selfServeArr: number
}

export interface QuarterActuals {
  newArr: number
  expansionArr: number
  churnArr: number
  netNewArr: number
  bySegment: Record<Segment, number>
  /** Per person: realised net new ARR. Used for accuracy and bias. */
  byPerson: Record<string, number>
}

export interface Quarter {
  id: string // e.g. '2026-Q3'
  label: string // e.g. 'Q3 2026'
  start: string
  end: string
  isCurrent: boolean
  /** Weeks with data. 13 for closed quarters; for the current quarter, the weeks up to "today". */
  weeksElapsed: number
  plan: Record<Segment, number>
  /** ARR at the start of the quarter (for the bridge). */
  startingArr: number
  /** One per elapsed week, index 0 = week 1. */
  snapshots: WeekSnapshot[]
  /** Seeded calls for every person for every elapsed week. */
  calls: Call[]
  /** Only for closed quarters. */
  actuals?: QuarterActuals
}

/** Everything the generator produces. Deterministic for a given seed. */
export interface Dataset {
  seed: number
  company: string
  org: Org
  accounts: Account[]
  /** Oldest first; last item is the current quarter. At least 4 closed quarters before it. */
  quarters: Quarter[]
  /** "Today" in the current quarter. */
  currentWeek: Week
}

// ───────────────────────────── Model outputs ─────────────────────────────

export interface ModelRange {
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export type CommitRuleId =
  | 'late-stage'
  | 'close-in-quarter'
  | 'economic-buyer'
  | 'close-plan'
  | 'recent-activity'
  | 'push-limit'

export interface EligibilityResult {
  eligible: boolean
  failedRules: { id: CommitRuleId; label: string }[]
}

export interface BiasStat {
  /** Average of (actual ÷ commit call) over past quarters, at the same week of quarter. 0.86 = lands at 86% of commit. */
  commitRatio: number
  /** Same for most-likely. */
  mostLikelyRatio: number
  quartersUsed: number
}

// ───────────────────────────── View models ─────────────────────────────

export interface DealRow {
  deal: Deal
  eligibility: EligibilityResult
  /** Category is Commit but eligibility failed. */
  commitAtRisk: boolean
  winProbability: number
}

export interface PathToPlan {
  plan: number
  closed: number
  /** Commit call minus closed. */
  committedOpen: number
  /** max(0, plan - commit call). */
  gap: number
  /** Change in the commit call since last week. */
  changeSinceLastWeek: number
}

export interface Coverage {
  /** Open pipeline in quarter (Pipeline + Best Case + Commit, not closed). */
  openPipeline: number
  /** plan - closed. */
  remaining: number
  ratio: number
  target: number
}

export interface RepView {
  person: Person
  quarterLabel: string
  week: Week
  deadline: string // e.g. 'Monday 17:00'
  quota: number
  closed: number
  /** Pre-fill from the rep's deals by category. */
  prefill: CallTriple
  /** Latest submitted call this week (user call wins over seed), or null if not yet submitted. */
  submitted: Call | null
  deals: DealRow[]
  /** SMB reps: model range for their book; MM/ENT: system forecast from win probabilities. */
  model: ModelRange
  bias: BiasStat | null
  coverage: Coverage
}

export interface TeamRow {
  person: Person
  call: CallTriple
  /** Commit × bias.commitRatio; null when not enough history. */
  likelyToLand: number | null
  biasNote: string | null // e.g. 'lands at 86% of commit on average'
  model: number // p50 for this person's book
  warning: string | null // e.g. 'Commit 18% above model'
  submitted: boolean
}

/** Manager and Director share this screen. */
export interface TeamView {
  person: Person
  quarterLabel: string
  week: Week
  deadline: string
  reportsLabel: string // e.g. '5 reps' / '3 managers'
  rows: TeamRow[]
  /** Sum of the reports' calls. */
  reportsSum: CallTriple
  /** This person's own submitted call, or null. */
  ownCall: Call | null
  model: ModelRange
  pathToPlan: PathToPlan
  atRiskCommits: DealRow[]
  coverage: Coverage
}

export interface ChainStep {
  level: 'Reps' | 'Managers' | 'Directors' | 'CRO'
  value: CallTriple
  /** Change vs the level below (most-likely). 0 for Reps. */
  delta: number
  reasons: { personName: string; text: string }[]
}

export type WowKind = 'new' | 'pulled-in' | 'pushed' | 'lost' | 'won' | 'amount-change' | 'category-change'

export interface WowChange {
  kind: WowKind
  /** Effect on the most-likely number, signed. */
  amount: number
  dealCount: number
}

export interface SegmentRow {
  segment: Segment
  directorName: string
  plan: number
  call: CallTriple
  model: ModelRange
  closed: number
  coverage: Coverage
}

export interface CroView {
  person: Person
  quarterLabel: string
  week: Week
  deadline: string
  segments: SegmentRow[]
  reportsSum: CallTriple
  ownCall: Call | null
  model: ModelRange
  plan: number
  chain: ChainStep[]
  /** Week-over-week movement of the most-likely number, from last week to this week. */
  wow: { from: number; to: number; changes: WowChange[] }
}

export interface ArrBridge {
  startingArr: number
  newArr: number
  expansionArr: number
  churnArr: number // positive number, shown as a reduction
  endingArr: number
}

export interface TrendPoint {
  week: Week
  /** CRO most-likely call that week; null for future weeks. */
  call: number | null
  model: ModelRange | null
}

export interface Kpi {
  id: 'nrr' | 'grr' | 'credit-utilisation' | 'coverage' | 'win-rate' | 'cycle-days' | 'self-serve-conversion'
  label: string
  value: number
  /** Formatting hint. */
  unit: '%' | 'x' | 'days'
  /** Change vs last quarter, same unit. */
  change: number | null
  target?: number
}

export interface BoardView {
  quarterLabel: string
  week: Week
  call: CallTriple
  plan: number
  model: ModelRange
  /** e.g. 'Over the last 4 quarters the week-6 call landed within 4% of actual.' */
  accuracyNote: string
  /** Net new ARR split: new customers, expansion, churn (the waterfall). */
  bridge: ArrBridge
  trend: TrendPoint[]
  segments: { segment: Segment; call: number; plan: number }[]
  kpis: Kpi[]
}

export interface AccuracyPoint {
  quarterLabel: string
  week: Week
  /** actual ÷ call. */
  ratio: number
}

export interface PersonAccuracy {
  person: Person
  bias: BiasStat
  /** Mean absolute % error of the most-likely call at week 6, past quarters. */
  mape: number
}

export interface CalibrationRow {
  quarterLabel: string
  actual: number
  model: ModelRange
  insideP10P90: boolean
}

export interface AccuracyView {
  /** For each level, average accuracy of the most-likely call by week of quarter (1..13), over closed quarters. */
  byWeek: { level: ChainStep['level']; points: { week: Week; ratio: number }[] }[]
  people: PersonAccuracy[]
  calibration: { segment: Segment; rows: CalibrationRow[] }[]
  slipRate: number // share of commit deals whose close date moved out of the quarter
  pushRate: number // share of deals pushed at least once
  commitConversion: number // share of commit value that closed won
}

// ───────────────────────────── App state ─────────────────────────────

/** Input to every selector besides the dataset. */
export interface ViewInput {
  week: Week
  /** Calls the visitor submitted in the app (saved to localStorage). These win over seed calls for the same person and week. */
  userCalls: Call[]
}
