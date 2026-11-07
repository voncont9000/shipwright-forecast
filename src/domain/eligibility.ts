import { LATE_STAGES } from './types'
import type { CommitRuleId, Deal, EligibilityResult } from './types'
import { diffDays } from './dates'

export interface EligibilityContext {
  /** Snapshot date the deal is judged on. */
  asOf: string
  quarterStart: string
  quarterEnd: string
}

export const MAX_DAYS_SINCE_ACTIVITY = 14
export const MAX_CLOSE_DATE_PUSHES = 1

export const RULE_LABELS: Record<CommitRuleId, string> = {
  'late-stage': 'Not yet at Negotiation or later',
  'close-in-quarter': 'Close date is outside the quarter',
  'economic-buyer': 'No economic buyer identified',
  'close-plan': 'No mutual close plan',
  'recent-activity': 'No activity in the last 14 days',
  'push-limit': 'Close date pushed more than once',
}

/**
 * The six commit-eligibility rules. A deal can still be marked Commit when it fails;
 * it then shows as "Commit at risk" with these labels.
 */
export function checkEligibility(deal: Deal, ctx: EligibilityContext): EligibilityResult {
  const failed: CommitRuleId[] = []
  if (!LATE_STAGES.includes(deal.stage)) failed.push('late-stage')
  if (deal.closeDate < ctx.quarterStart || deal.closeDate > ctx.quarterEnd) failed.push('close-in-quarter')
  if (!deal.economicBuyerIdentified) failed.push('economic-buyer')
  if (!deal.mutualClosePlan) failed.push('close-plan')
  if (diffDays(deal.lastActivityDate, ctx.asOf) > MAX_DAYS_SINCE_ACTIVITY) failed.push('recent-activity')
  if (deal.closeDatePushes > MAX_CLOSE_DATE_PUSHES) failed.push('push-limit')
  return {
    eligible: failed.length === 0,
    failedRules: failed.map((id) => ({ id, label: RULE_LABELS[id] })),
  }
}

/** Short one-line explanation of why a deal is held back, e.g. "No economic buyer · pushed twice". */
export function riskSummary(deal: Deal, result: EligibilityResult, asOf: string): string {
  const parts = result.failedRules.map((r) => {
    switch (r.id) {
      case 'late-stage': return `Still at ${deal.stage} stage`
      case 'close-in-quarter': return 'Close date outside quarter'
      case 'economic-buyer': return 'No economic buyer'
      case 'close-plan': return 'No mutual close plan'
      case 'recent-activity': return `No activity for ${diffDays(deal.lastActivityDate, asOf)} days`
      case 'push-limit': return `Pushed ${deal.closeDatePushes} times`
    }
  })
  return parts.join(' · ')
}
