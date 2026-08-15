import { useEffect, useRef, type ReactNode } from "react";
import { IkidLogo } from "../components/Logo";

/**
 * Public landing page — #/welcome, no sign-in required.
 * Layout inspired by modern fintech marketing sites (two-column hero with a
 * live product mockup, stat strip, dense feature grid, deep-dives, FAQ).
 * The "screenshots" are animated mockups of the real screens so they always
 * match the product and loop like short demo clips.
 */

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("shown");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="reveal" style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ---------- animated mockups ---------- */

function MockWindow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 text-xs text-slate-400 font-grotesk">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ImportMock() {
  const rows = [
    ["KROGER #688", "Groceries", "#22c55e", "-$84.12"],
    ["STARBUCKS 08736", "Coffee", "#a16207", "-$7.85"],
    ["ACME PAYROLL", "Salary", "#16a34a", "+$3,400"],
    ["CARD AUTOPAY", "Transfer", "#94a3b8", "excluded"],
    ["CHEVRON 0203571", "Transportation", "#f59e0b", "-$48.20"],
  ];
  return (
    <MockWindow title="import — statement.csv">
      <div className="space-y-2 font-grotesk text-xs">
        {rows.map(([desc, cat, color, amt], i) => (
          <div
            key={desc}
            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800"
            style={{ animation: `slideIn .5s ease both ${0.3 + i * 0.35}s` }}
          >
            <span className="text-slate-600 dark:text-slate-300">{desc}</span>
            <span className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[12px] font-medium"
                style={{ backgroundColor: color + "22", color, animation: `popIn .3s ease both ${0.7 + i * 0.35}s` }}
              >
                {cat}
              </span>
              <span className="tabular-nums text-slate-500">{amt}</span>
            </span>
          </div>
        ))}
      </div>
    </MockWindow>
  );
}

function DashboardMock() {
  const bars = [42, 68, 55, 80, 62, 90];
  return (
    <MockWindow title="ikid — dashboard">
      <div className="grid grid-cols-3 gap-2 font-grotesk">
        {[["Income", "$3,950", "#1a7f5a"], ["Spending", "$3,260", "#a4123a"], ["Saved", "$690", "#6366f1"]].map(
          ([l, v, c], i) => (
            <div key={l} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800" style={{ animation: `popIn .4s ease both ${i * 0.15}s` }}>
              <div className="text-[12px] uppercase tracking-wide text-slate-400">{l}</div>
              <div className="text-base font-bold tabular-nums" style={{ color: c }}>{v}</div>
            </div>
          ),
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-5">
        <div className="flex h-28 flex-1 items-end gap-2">
          {bars.map((h, i) => (
            <div key={i} className="flex flex-1 items-end gap-1">
              <div className="flex-1 origin-bottom rounded-t bg-emerald-500" style={{ height: `${h}%`, animation: `growUp .7s ease both ${0.3 + i * 0.12}s` }} />
              <div className="flex-1 origin-bottom rounded-t bg-rose-400" style={{ height: `${h * 0.7}%`, animation: `growUp .7s ease both ${0.36 + i * 0.12}s` }} />
            </div>
          ))}
        </div>
        <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
          <circle cx="50" cy="50" r="41" fill="none" stroke="#e2e8f0" strokeWidth="14" />
          <circle cx="50" cy="50" r="41" fill="none" stroke="#1a7f5a" strokeWidth="14" strokeDasharray="260" strokeDashoffset="80" style={{ animation: "drawArc 1.4s ease both .5s" }} />
          <circle cx="50" cy="50" r="41" fill="none" stroke="#f59e0b" strokeWidth="14" strokeDasharray="70 190" strokeDashoffset="-180" style={{ animation: "drawArc 1.4s ease both .8s" }} />
        </svg>
      </div>
    </MockWindow>
  );
}

function BudgetMock() {
  const budgets = [
    ["Groceries", 64, "#22c55e"],
    ["Dining", 88, "#f97316"],
    ["Entertainment", 41, "#d946ef"],
  ] as const;
  return (
    <MockWindow title="budgets & goals">
      <div className="space-y-3 font-grotesk text-xs">
        {budgets.map(([name, pct, color], i) => (
          <div key={name}>
            <div className="mb-1 flex justify-between text-slate-600 dark:text-slate-300">
              <span>{name}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, animation: `fillBar 1s ease both ${0.2 + i * 0.25}s` }} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
          <span>🏠 House down payment</span>
          <span className="text-emerald-600">done Aug 2029 →</span>
        </div>
      </div>
    </MockWindow>
  );
}

function PlannerMock() {
  return (
    <MockWindow title="planner — what if?">
      <div className="space-y-2.5 font-grotesk text-xs">
        <div className="ml-auto w-fit max-w-[80%] rounded-2xl bg-brand-600 px-3 py-2 text-white" style={{ animation: "popIn .4s ease both .3s" }}>
          Buy a house for $450k with 10% down?
        </div>
        <div className="w-fit max-w-[85%] rounded-2xl bg-slate-100 px-3 py-2 dark:bg-slate-800" style={{ animation: "popIn .4s ease both 1s" }}>
          Upfront cash: <b>$58,500</b> — saved by <b>Mar 2028</b> at your pace. Mortgage ≈ <b>$2,560/mo</b>;
          savings rate 26% → 11%.
        </div>
        <div className="flex w-fit gap-1 rounded-2xl bg-slate-100 px-3 py-2 dark:bg-slate-800" style={{ animation: "popIn .3s ease both 1.6s" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animation: `blinkDot 1.2s infinite ${i * 0.2}s` }} />
          ))}
        </div>
      </div>
    </MockWindow>
  );
}

/* ---------- page ---------- */

const NAV_SECTIONS = [
  { id: "features", label: "Features" },
  { id: "how", label: "How it works" },
  { id: "privacy", label: "Privacy" },
  { id: "faq", label: "FAQ" },
];

const CARDS = [
  { icon: "📄", title: "Statement import", body: "Drop CSV or PDF from any bank. Columns auto-detected, duplicates skipped, 190+ rules categorize instantly." },
  { icon: "📊", title: "Dashboards that drill down", body: "Cash flow, category donuts, heatmaps, a Conscious Spending Plan — every chart clicks through to the transactions." },
  { icon: "🎯", title: "Budgets with forecasts", body: "Monthly limits with spent, remaining, and a projected end-of-month total so overshoots surface early." },
  { icon: "🏁", title: "Goals that date themselves", body: "Targets compute their own completion dates, required contributions, and projection curves." },
  { icon: "🧮", title: "What-if planner", body: "House, car, wedding, career break — exact math from your real averages, plus optional local AI chat." },
  { icon: "👥", title: "Accounts for the household", body: "Each person gets a separate database behind their own password. Nobody sees anyone else's numbers." },
];

const FAQS = [
  ["Is my data really private?", "Yes — architecturally. Ikid is a local app: your transactions live in a SQLite file on your own disk, the API only listens on your machine, and there are zero calls to any external service. Delete the folder and every trace is gone."],
  ["Does it connect to my bank?", "No, by design. You export a CSV or PDF statement from your bank's website and drop it in. That means no credentials shared with anyone, ever — and it works with any bank in the world."],
  ["What does the AI see?", "The optional planner AI runs via Ollama on your own computer. It receives only summary averages (income, spending, savings) as context, and every calculation comes from Ikid's deterministic engine, not the model."],
  ["How much does it cost?", "Nothing. It's your software running on your hardware — no subscription, no ads, no premium tier."],
];

export default function Landing() {
  return (
    <div className="font-grotesk">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/85 backdrop-blur dark:border-slate-800/60 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-5 py-3">
          <a href="#/welcome"><IkidLogo height={28} /></a>
          <nav className="ml-2 hidden gap-5 text-sm text-slate-500 md:flex">
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.id}
                href="#/welcome"
                onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }); }}
                className="hover:text-brand-600"
              >
                {s.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href="#/" className="btn-ghost">Sign in</a>
            <a href="#/signup" className="btn-primary">Sign up</a>
          </div>
        </div>
      </header>

      {/* hero — two columns, no dead space */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 right-0 h-96 w-96 rounded-full bg-brand-400/15 blur-3xl" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 md:grid-cols-2 md:py-20">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-300/60 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-300" style={{ animation: "popIn .5s ease both" }}>
              🔒 100% local · no bank logins · no subscription
            </div>
            <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight md:text-5xl" style={{ animation: "rise .6s ease both .1s" }}>
              Know where every dollar goes — <span className="text-brand-600">without sending it anywhere.</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-slate-500 dark:text-slate-400" style={{ animation: "rise .6s ease both .25s" }}>
              Ikid (Amharic for <em>"plan"</em>) turns bank statements into budgets, goals, and
              what-if plans. Everything stays on your computer.
            </p>
            <div className="mt-6 flex gap-3" style={{ animation: "rise .6s ease both .4s" }}>
              <a href="#/signup" className="btn-primary !px-6 !py-3 !text-base">Sign up — it's free</a>
              <a href="#/" className="btn-ghost !px-6 !py-3 !text-base">Sign in</a>
            </div>
            <ul className="mt-6 space-y-1.5 text-sm text-slate-500 dark:text-slate-400" style={{ animation: "rise .6s ease both .5s" }}>
              <li>✓ Works with any bank — import CSV or PDF statements</li>
              <li>✓ Your data never leaves this machine</li>
              <li>✓ Set up in two minutes with <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">npm run dev</code></li>
            </ul>
          </div>
          <div style={{ animation: "rise .7s ease both .3s" }}>
            <DashboardMock />
          </div>
        </div>
      </section>

      {/* stat strip */}
      <section className="border-y border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-5 py-6 text-center md:grid-cols-4">
          {[["100%", "local — zero cloud calls"], ["$0", "forever, no subscription"], ["190+", "built-in categorization rules"], ["1 file", "is your whole database"]].map(([n, l]) => (
            <div key={l}>
              <div className="font-display text-3xl font-extrabold text-brand-600">{n}</div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* feature card grid */}
      <section id="features" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Reveal>
            <h2 className="text-center font-display text-3xl font-extrabold md:text-4xl">Everything your money does, in one place</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-slate-500 dark:text-slate-400">
              The features of a commercial finance app — minus the account, the fee, and the data harvesting.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CARDS.map((c, i) => (
              <Reveal key={c.title} delay={i * 60}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-lg dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-2xl">{c.icon}</div>
                  <h3 className="mt-2 font-display text-lg font-bold">{c.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* deep dives */}
      <section id="how" className="scroll-mt-16 border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl space-y-16 px-5 py-16">
          <Reveal>
            <h2 className="text-center font-display text-3xl font-extrabold md:text-4xl">How it works</h2>
          </Reveal>
          <Deep kicker="01 · Import" title="Drop a statement, get clean data"
            body="Export a statement from your bank's site and drag it in. Ikid detects the columns, hashes out duplicates, categorizes with keyword rules, and learns from every correction you make. Credit-card payments are recognized as transfers so they never count twice."
            mock={<ImportMock />} />
          <Deep flip kicker="02 · Understand" title="Every chart drills to the penny"
            body="Monthly trends, merchant leaderboards, spending heatmaps, and a Ramit Sethi-style Conscious Spending Plan. Nothing is a dead end — click any bar, slice, or row and land on the exact transactions behind it."
            mock={<DashboardMock />} />
          <Deep kicker="03 · Plan" title="Budgets that forecast, goals that date themselves"
            body="Budgets show spent, remaining, and a projected end-of-month total. Goals compute completion dates and the monthly contribution a deadline demands, with live what-if math as you adjust."
            mock={<BudgetMock />} />
          <Deep flip kicker="04 · Ask" title="A planner you can talk to"
            body={`"Buy a house for $450k with 10% down?" "Can I stop working for 8 months?" A deterministic engine answers instantly with exact math from your real averages. Install Ollama and freeform questions get a local AI's voice — numbers still come from the engine.`}
            mock={<PlannerMock />} />
        </div>
      </section>

      {/* privacy band */}
      <section id="privacy" className="scroll-mt-16 bg-[#0e3d33] text-emerald-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-2 md:items-center">
          <Reveal>
            <div>
              <h2 className="font-display text-3xl font-extrabold md:text-4xl">Private by architecture, not by promise</h2>
              <p className="mt-4 leading-relaxed text-emerald-100/80">
                Everything is a file on your disk: one SQLite database per person, an API that only
                answers localhost, and zero third-party calls. Households share one install with
                scrypt-hashed passwords and per-request database isolation.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <ul className="space-y-3 text-sm">
              {[
                "No bank credentials — you import statements yourself",
                "No cloud, no telemetry, no ads, no tracking pixels",
                "Backups are just file copies you control",
                "Optional AI runs locally via Ollama — nothing leaves the machine",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 rounded-xl bg-emerald-50/10 px-4 py-3">
                  <span className="text-brand-300">✓</span>{t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <Reveal>
            <h2 className="text-center font-display text-3xl font-extrabold">Questions, answered</h2>
          </Reveal>
          <div className="mt-8 space-y-3">
            {FAQS.map(([q, a], i) => (
              <Reveal key={q} delay={i * 60}>
                <details className="group rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                  <summary className="cursor-pointer list-none font-display text-base font-bold marker:hidden">
                    <span className="mr-2 text-brand-600 transition-transform group-open:rotate-90 inline-block">›</span>{q}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center">
          <Reveal>
            <h2 className="font-display text-4xl font-extrabold">Ready when you are</h2>
            <p className="mt-3 text-slate-500 dark:text-slate-400">Two minutes from install to your first imported statement.</p>
            <div className="mt-6 flex justify-center gap-3">
              <a href="#/signup" className="btn-primary !px-8 !py-3 !text-base">Sign up →</a>
              <a href="#/" className="btn-ghost !px-8 !py-3 !text-base">Sign in</a>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-6 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 text-xs text-slate-400">
          <IkidLogo height={20} />
          <span>local-first personal finance · your data never leaves this computer</span>
        </div>
      </footer>
    </div>
  );
}

function Deep({ kicker, title, body, mock, flip = false }: {
  kicker: string; title: string; body: string; mock: ReactNode; flip?: boolean;
}) {
  return (
    <div className={`grid items-center gap-10 md:grid-cols-2 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}>
      <Reveal>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">{kicker}</div>
          <h3 className="mt-2 font-display text-2xl font-extrabold leading-snug md:text-3xl">{title}</h3>
          <p className="mt-3 leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
        </div>
      </Reveal>
      <Reveal delay={150}>{mock}</Reveal>
    </div>
  );
}
