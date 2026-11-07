import type {
  AccuracyView, BoardView, Call, CroView, Dataset, Person, RepView, TeamView, ViewInput, Week,
} from './types'

/**
 * Everything the screens need. Implemented for real in src/domain/selectors.ts (agent A);
 * faked with fixed sample data in src/ui/stubApi.ts (agent B) until the merge.
 * Screens import only from src/ui/api.ts, which re-exports one of the two.
 */
export interface ForecastApi {
  /** Build the seeded demo company. Deterministic for a given seed. */
  loadDataset(seed?: number): Dataset

  people(ds: Dataset): Person[]
  /** Direct reports of a person, ordered by name. */
  reportsOf(ds: Dataset, personId: string): Person[]

  repView(ds: Dataset, input: ViewInput, personId: string): RepView
  /** Manager or director. */
  teamView(ds: Dataset, input: ViewInput, personId: string): TeamView
  croView(ds: Dataset, input: ViewInput): CroView
  boardView(ds: Dataset, input: ViewInput): BoardView
  accuracyView(ds: Dataset): AccuracyView

  /**
   * Validate and build a call the visitor is about to submit.
   * Returns an error message when a reason is required (call differs from the reports' sum
   * or the rep pre-fill) and none was given, or when commit > mostLikely > bestCase is violated.
   */
  prepareCall(
    ds: Dataset, input: ViewInput, personId: string,
    values: { commit: number; mostLikely: number; bestCase: number; reason?: string },
  ): { ok: true; call: Call } | { ok: false; error: string }

  /** Deadline label for a role in a given week, e.g. 'Tuesday 17:00'. */
  deadlineFor(role: Person['role']): string
  maxWeek(ds: Dataset): Week
}
