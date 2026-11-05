# Forecasting tool demo: design and build plan

## Context
Vincent wants a portfolio/interview demo of a B2B forecasting tool for a fictional company with a Lovable-style
business model: subscription tiers that include credits, plus credit top-ups. Sales covers SMB, Mid-Market and
Enterprise. The audience is a **RevOps / CRO-track hiring panel**, so the forecasting method is the main thing on
show and the UI only needs to look credible. Decisions so far:
- **Number forecast:** net new ARR for the quarter = new logos + expansion − churn/downgrade, split by motion.
- **Build:** React + TypeScript web app with no server. Seeded made-up data and all maths run in the browser.
  A "View as" switch covers Rep → Manager → Director → CRO → Board. It can be hosted for free (Vercel or GitHub Pages).
- The project folder is empty, so this starts from scratch.

The company is fictional: **"Shipwright"**, an AI app builder. It is not branded as Lovable.
Tiers: Free · Pro $25/mo (100 credits) · Teams $50/seat · Enterprise (custom, pooled credits). Extra credits are
sold as top-ups.

---

## 1. The forecasting method (what the app demonstrates)

### Org and segments
Board → CRO → 3 Directors (SMB / Mid-Market / Enterprise) → ~7 Managers → ~30 Reps. Each rep has a quota,
and quotas add up the tree to the board plan. That plan is the **top-down** number.

### Two ways to forecast, depending on how fast deals move
| | SMB (high volume) | Mid-Market / Enterprise (fewer, bigger deals) |
|---|---|---|
| Main source | **Statistical model** | **Rep call, checked deal by deal** |
| Model | Run-rate + cohort: self-serve trials × conversion × ARPA; upgrade likelihood from credit usage; churn from retention curves; sales-assisted deals × historical stage conversion. A Monte Carlo run gives a P10/P50/P90 range. | Each deal's win probability from its stage, age, close-date pushes, recent activity and deal-quality score, summed to a "system forecast" |
| Role of the rep | The rep call is checked against the model. If it falls outside the model's P25–P75 band, it is flagged. | The rep call is the main number. The system forecast is a sanity check. |

**Credit usage is the Lovable-specific signal:** accounts using more than 80% of their credits for 2+ months
are expansion candidates. Accounts whose usage is falling are churn or downgrade risks. This feeds expansion and
churn forecasts in every segment.

### Forecast categories (set by the rep on each deal)
Pipeline · Best Case · Commit · Closed Won · Omitted.
**Commit eligibility rules** decide whether a deal should count in the forecast. A deal must have:
- a stage of Negotiation or later
- a close date inside the quarter
- an identified economic buyer
- a mutual close plan or known paper process
- activity in the last 14 days
- no more than 1 close-date push

A rep can still mark a deal Commit when it fails a rule. The deal then shows as **"Commit at risk"** with the
failed rules listed, and it appears on the manager's inspection list. This flags the deal without blocking it.

### Forecast calls and roll-up: overrides never erase anything
- Every level submits three numbers each week: **Commit / Most Likely / Best Case**.
- A rep's call is pre-filled from their deals by category, and the rep can adjust it.
- A manager sees the **sum of their reps' calls**, then submits their own call. Any change must come with a reason.
- Directors and the CRO work the same way. Every level's number is **stored separately**, so any screen can show
  "reps' sum → manager → director → CRO" side by side, with the change at each step and the reason for it.
- **Weekly deadlines:** reps Monday, managers Tuesday, directors Wednesday, CRO Thursday. Each submitted call is
  frozen as a weekly snapshot.

### Top-down vs bottom-up (triangulation)
At every level and in the board view, three numbers are shown together:
- **Plan** (top-down quota)
- **Bottom-up call** (people's judgement)
- **Model** (statistical)

The view also shows the gap to plan and the pipeline coverage needed to close it. Coverage targets are 3× for
Mid-Market and 4× for Enterprise early in the quarter.

### Getting more accurate over time
Weekly snapshots make the following possible:
- **Accuracy by week of quarter**: final actual ÷ the call made in weeks 4, 8 and 13, for each person and level.
- **Bias**: a person's average tendency to over- or under-call. A manager sees a **bias-adjusted** number next to
  each rep's call, for example "lands at 86% of commit on average".
- **Slip rate** and **close-date push rate**, plus **commit-to-close conversion**.
- **Model recalibration**: stage win rates and SMB conversion rates are re-learned from closed history each quarter.
- **Week-over-week change chart**: how the call moved this week (new, pulled in, pushed, lost, won, amount changed).

### Key metrics
Commit / Most Likely / Best Case / Closed; pipeline coverage; win rate; sales cycle length; average deal size;
pipeline created; slip rate; forecast accuracy and bias; NRR and GRR; credit utilisation; self-serve conversion.

### Screens
1. **Rep:** deal list with categories and eligibility flags, weekly call form, quota progress.
2. **Manager / Director:** each rep's call vs their bias-adjusted figure vs the model, at-risk commits,
   an override form with a reason, and coverage.
3. **CRO:** segment view of plan vs call vs model, the chain of calls up the tree, the week-over-week change chart.
4. **Board:** quarter net new ARR with a range, an ARR bridge (start → new → expansion → churn → end), how the
   call has moved through the quarter, and plan attainment.
5. **Accuracy:** history of accuracy and bias per person and level, and model calibration.
6. **Methodology:** a short page that explains all of the above for interviewers.

A **week slider** lets the viewer step through the current quarter, so the panel can watch the forecast come
together week by week.

---

## 2. Architecture

Vite + React + TypeScript, Tailwind, Recharts for charts, Zustand for app state saved to localStorage (with a
"Reset demo" button), and Vitest for tests. The forecasting logic is plain TypeScript with no UI code, so it can
be tested on its own.

```
src/domain/types.ts        shared types (Org, Rep, Deal, Account, Call, Snapshot)
src/data/generator.ts      seeded fictional company: org, accounts, credit usage, deals, 4 quarters + current
src/domain/eligibility.ts  commit rules → { eligible, failedRules[] }
src/domain/rollup.ts       sums calls up the tree, keeps every level's number, tracks changes and reasons
src/domain/smbModel.ts     run-rate/cohort model + Monte Carlo P10/P50/P90
src/domain/dealModel.ts    win probability per deal, system forecast
src/domain/accuracy.ts     accuracy by week, bias, slip rate, recalibration
src/domain/bridge.ts       ARR bridge and week-over-week change chart
src/store/                 Zustand store (role, week, submitted calls)
src/views/                 Rep, Manager, Director, CRO, Board, Accuracy, Methodology
```

---

## 3. Build steps (following Vincent's working rules)

1. Run `git init` and write the spec to `docs/superpowers/specs/2026-11-05-forecasting-tool-design.md`.
   This is a local commit only, with no push.
2. **Prototype first:** build a Design canvas artifact showing the Manager and Board screens, share the link,
   and **wait for Vincent's approval** before writing any UI code.
3. The main thread writes `types.ts`, so the agents share one contract.
4. Two Sonnet agents work in parallel, each in its own git worktree:
   - **A: data and logic:** the generator plus every `domain/*` module, with Vitest tests.
   - **B: UI:** the screens from the approved prototype, built on the shared types with stub data until A merges.
5. The main thread reviews both diffs. Rollup, override and accuracy logic gets a full review because it is the
   core logic. Then it merges, wires the real data in, and screenshots each role.
6. Give Vincent step-by-step hosting instructions. He runs the deploy himself.

## 4. Verification
- `npm test`: tests that check
  - roll-up totals are correct at each level
  - an override keeps the numbers below it
  - eligibility rules work on edge cases
  - the bias calculation matches on a hand-worked example
  - the SMB model is roughly calibrated: about 80% of past quarters fall inside its P10–P90 range on the generated history
- `npm run build` passes with no type errors.
- Run the app and click through each role: submit a rep call, override it as manager with a reason, and check
  the change appears at Director, CRO and Board. Move the week slider and check the accuracy charts update.
  Reset the demo.
