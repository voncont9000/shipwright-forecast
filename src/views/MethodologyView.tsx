import type { ReactNode } from 'react'

const SECTIONS: { id: string; title: string }[] = [
  { id: 'what', title: 'What is being forecast' },
  { id: 'categories', title: 'Categories and the commit rules' },
  { id: 'layers', title: 'Layered calls' },
  { id: 'cadence', title: 'The weekly cadence' },
  { id: 'triangulation', title: 'Three numbers, side by side' },
  { id: 'methods', title: 'SMB versus Mid-Market and Enterprise' },
  { id: 'credits', title: 'Credit-usage signals' },
  { id: 'accuracy', title: 'The accuracy loop' },
]

const RULES: { title: string; text: string }[] = [
  { title: 'Late stage', text: 'The deal is in Negotiation or Contracting.' },
  { title: 'Closes this quarter', text: 'The close date falls inside the quarter.' },
  { title: 'Economic buyer', text: 'Someone who can sign has been identified.' },
  { title: 'Close plan', text: 'There is a mutual close plan, or the paper process is known.' },
  { title: 'Recent activity', text: 'Something has happened on the deal in the last 14 days.' },
  { title: 'Stable date', text: 'The close date has been pushed at most once.' },
]

const DAYS: { day: string; who: string }[] = [
  { day: 'Monday', who: 'Reps' }, { day: 'Tuesday', who: 'Managers' }, { day: 'Wednesday', who: 'Directors' }, { day: 'Thursday', who: 'CRO' },
]

export function MethodologyView() {
  return (
    <main className="mx-auto grid max-w-[1280px] grid-cols-1 gap-10 px-8 pb-24 pt-10 lg:grid-cols-[200px_minmax(0,720px)] lg:gap-16">
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-8 flex flex-col gap-2.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">On this page</span>
          {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="text-muted no-underline hover:text-ink">{s.title}</a>)}
        </div>
      </nav>

      <article className="flex flex-col gap-12 text-base leading-[1.7]">
        <header className="flex flex-col gap-3">
          <h1 className="m-0 text-[32px] font-semibold leading-tight tracking-[-0.015em]">How this forecast works</h1>
          <p className="m-0 text-lg text-muted">
            Shipwright sells an AI app builder through subscription tiers that include credits, plus top-ups when customers run out.
            This page explains the thinking behind every number in the app, in the order a forecast call is made.
          </p>
        </header>

        <Section id="what" title="What is being forecast">
          <p>
            The number is <strong>net new ARR for the quarter</strong>: the recurring revenue added from new customers, plus expansion from
            existing ones, minus what churns or downgrades. Bookings alone would flatter a business like this one. A usage-priced product can
            win a customer in week two and lose another to falling usage in week nine, and the board cares about the net movement in ARR.
          </p>
          <div className="num rounded-xl border border-line bg-card px-5 py-4 text-center text-[15px]">
            Net new ARR = new customers + expansion − churn and downgrades
          </div>
          <p>
            Every figure is split by segment (SMB, Mid-Market, Enterprise), because the three behave like different businesses and are
            forecast differently, as the section on methods explains.
          </p>
        </Section>

        <Section id="categories" title="Categories and the commit rules">
          <p>
            Reps place each deal in one forecast category: <em>Pipeline</em>, <em>Best Case</em>, <em>Commit</em>, <em>Closed Won</em> or
            <em> Omitted</em>. A rep's weekly call is pre-filled from those categories, so the call starts from the deals and not from a feeling.
          </p>
          <p>
            Commit is the category that carries weight, so it has an entry test. A deal should meet six rules before it counts as Commit:
          </p>
          <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
            {RULES.map((r, i) => (
              <li key={r.title} className="flex gap-3 rounded-xl border border-line bg-card px-4 py-3.5">
                <span className="num mt-0.5 flex size-6 flex-none items-center justify-center rounded-full bg-[#EEF1F5] text-xs font-semibold text-[#344054]">{i + 1}</span>
                <span className="text-[15px] leading-snug"><strong className="font-semibold">{r.title}.</strong> <span className="text-muted">{r.text}</span></span>
              </li>
            ))}
          </ol>
          <p>
            The rules <strong>flag; they do not block</strong>. A rep can still mark a deal Commit when it fails a rule, and it then shows a
            <span className="mx-1 whitespace-nowrap rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-[#8A3F06]">Commit at risk</span>
            chip with the broken rules spelled out. Blocking would push the judgement off the page and into side conversations; flagging puts it in front of the manager,
            who is the person best placed to decide whether the exception is real.
          </p>
        </Section>

        <Section id="layers" title="Layered calls">
          <p>
            Every level submits three numbers each week: Commit, Most likely and Best case. A manager sees the sum of their reps' calls,
            then submits their own. If it differs from the sum, a reason is required. Directors and the CRO do the same with the level beneath them.
          </p>
          <p>
            What makes this useful is that <strong>an override never erases the layer below it</strong>. Each level's call is stored on its own,
            so the CRO screen can show reps, managers, directors and the CRO side by side, with the change at each step and who explained it.
            When the company number moves, you can see whether the move came from the field's deals or from a leader's judgement,
            and over time the accuracy screen shows whose judgement has earned that trust.
          </p>
        </Section>

        <Section id="cadence" title="The weekly cadence">
          <p>
            The roll-up needs an order, so each level has a deadline: reps on Monday, managers on Tuesday, directors on Wednesday and the CRO on Thursday.
            By Thursday evening the call is frozen as that week's snapshot. The snapshots are what make the week-by-week views possible,
            including the week slider at the top of every screen.
          </p>
          <div className="grid grid-cols-4 gap-3">
            {DAYS.map((d, i) => (
              <div key={d.day} className="flex flex-col gap-0.5 rounded-xl border border-line bg-card px-4 py-3">
                <span className="text-xs text-muted">{i + 1}. {d.day}</span>
                <span className="font-semibold">{d.who}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="triangulation" title="Three numbers, side by side">
          <p>
            No single method is trusted alone. Every level shows the <strong>plan</strong> (the top-down quota), the <strong>bottom-up call</strong>
            (what the people closest to the deals say) and the <strong>model</strong> (a statistical estimate with a range).
            Where all three agree, confidence is high. Where they disagree, the gap is the interesting part: a call far above the model range is a question to ask,
            and a call below plan is a coverage question, so the screens show the gap to plan and the pipeline coverage needed to close it (3× for Mid-Market, 4× for Enterprise early in the quarter).
          </p>
        </Section>

        <Section id="methods" title="SMB versus Mid-Market and Enterprise">
          <p>
            SMB is a volume business: thousands of trials, self-serve upgrades and short sales cycles. No rep can have a view on each of them,
            so the <strong>statistical model leads</strong>. It combines trial volume, conversion and average revenue per account, upgrade likelihood from credit use,
            retention curves for churn, and stage conversion for the sales-assisted deals, then runs a Monte Carlo simulation to produce a P10 to P90 range.
            The SMB reps' calls are checked against it, and a call outside the model's middle band is flagged.
          </p>
          <p>
            Mid-Market and Enterprise are the opposite: few, large deals. Here the <strong>rep call leads</strong>, checked deal by deal. The system forecast,
            each deal's win probability from its stage, age, close-date pushes, recent activity and quality score, is added up as a sanity check rather than a replacement.
            Enterprise judgement about a specific legal review beats a model; a model beats an optimistic spreadsheet.
          </p>
        </Section>

        <Section id="credits" title="Credit-usage signals">
          <p>
            Because plans include credits, usage tells you what an account is about to do before the account does.
            An account using <strong>more than 80% of its included credits for two or more months</strong> is an expansion candidate: it is about to need a bigger tier or a top-up.
            An account whose usage is <strong>falling</strong> is a churn or downgrade risk, often months before a renewal conversation reveals it.
            These signals feed the expansion and churn parts of the forecast in every segment, which is why the bridge on the Board screen can show where the churn estimate came from.
          </p>
        </Section>

        <Section id="accuracy" title="The accuracy loop">
          <p>
            A forecast that never checks itself is just an opinion with a template. Because every week is stored, the app can compare each call with the final result
            and learn from the difference:
          </p>
          <p>
            <strong>Accuracy by week of quarter</strong> shows how the error shrinks as the quarter plays out, for every level.
            <strong> Bias</strong> captures each person's habit of running high or low, so a manager sees a bias-adjusted figure beside a rep's call, such as "lands at 86% of commit".
            <strong> Slip and push rates</strong>, and the share of Commit dollars that actually closed, show how much to trust the Commit category.
            And the <strong>model is recalibrated</strong> each quarter: stage win rates and SMB conversion rates are re-learned from closed history,
            and the calibration chart checks that roughly four in five actual results fall inside the model's P10 to P90 range.
          </p>
        </Section>
      </article>
    </main>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-4 [&_p]:m-0">
      <h2 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  )
}
