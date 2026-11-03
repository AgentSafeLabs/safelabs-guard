// Home: what SafeLabs Guard is, how a turn is checked, and the FAQ.
// Server component; the live agent is /live and the mock scenarios /scenarios.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import DemoVideo from "@/components/home/DemoVideo";
import Faq from "@/components/home/Faq";
import { AlertIcon, CameraIcon, CheckIcon, MicIcon, ShieldCheckIcon } from "@/components/icons";
import SiteFooter from "@/components/SiteFooter";
import { REPO_URL } from "@/lib/nav/links";

export const metadata: Metadata = {
  title: "SafeLabs Guard: verify what the agent sees before it acts",
  description:
    "A deterministic check between a camera and voice agent and its next action. It holds the action when the proposal and the evidence disagree.",
};

const btnPrimary =
  "inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-6 text-base font-bold text-accent-ink hover:brightness-110";
const btnSecondary =
  "inline-flex min-h-12 items-center justify-center rounded-xl border border-line-strong bg-surface px-6 text-base font-semibold text-ink hover:bg-chip";
const card = "rounded-2xl border border-line bg-surface p-5 sm:p-6";
const capsLabel = "text-xs font-bold uppercase tracking-widest text-accent";
const tile = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-allow-border bg-allow-bg text-accent";
const SECTION = "mt-16 lg:mt-[88px]";

function Heading({ label, title, sub, id }: { label: string; title: string; sub?: string; id: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className={capsLabel}>{label}</p>
      <h2 id={id} className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-[40px] sm:leading-[1.1]">
        {title}
      </h2>
      {sub && <p className="mt-4 text-base text-soft sm:text-lg">{sub}</p>}
    </div>
  );
}

function StatusChip({ kind }: { kind: "ALLOW" | "HOLD" }) {
  return kind === "ALLOW" ? (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-allow-border bg-allow-bg px-3 text-sm font-bold text-allow-text">
      <CheckIcon className="h-4 w-4" />
      ALLOW
    </span>
  ) : (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-hold-border bg-hold-bg px-3 text-sm font-bold text-hold-text">
      <AlertIcon className="h-4 w-4" />
      HOLD
    </span>
  );
}

const LEDGER_STEPS = [
  { n: 1, name: "Mug", note: "Red mug in frame" },
  { n: 2, name: "Notebook", note: "Blue notebook" },
  { n: 3, name: "Cable", note: "USB-C cable" },
  { n: 4, name: "Seal", note: "Box sealed" },
  { n: 5, name: "Ship", note: "One-time approval" },
];

function DemoMoment({ accent, title, chip, text }: { accent: "hold" | "allow"; title: string; chip: "ALLOW" | "HOLD"; text: string }) {
  const bar = accent === "hold" ? "border-l-hold-text" : "border-l-accent";
  const seg = accent === "hold" ? "bg-hold-text" : "bg-accent";
  return (
    <div className={`${card} border-l-[5px] ${bar}`}>
      <p className="text-xs font-bold uppercase tracking-widest text-muted">Step 1 of 5 · Verify the mug</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-bold text-ink">{title}</h3>
        <StatusChip kind={chip} />
      </div>
      <p className="mt-3 text-base text-soft">{text}</p>
      <div className="mt-5 grid grid-cols-5 gap-2" role="img" aria-label={`Progress: step 1 of 5 is ${chip === "HOLD" ? "held" : "allowed"}`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-2 rounded-full ${i === 0 ? seg : "bg-pending"}`} />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <main id="content" className="min-h-screen text-ink">
        <div className="mx-auto max-w-[1200px] px-8 pb-16 pt-10 sm:pt-16">
          {/* Hero */}
          <section className="relative grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12" aria-labelledby="hero-title">
            <div aria-hidden="true" className="hero-glow pointer-events-none absolute -inset-x-8 -inset-y-16 -z-10" />
            <div className="min-w-0">
              <p className="inline-flex min-h-8 items-center rounded-full border border-allow-border bg-allow-bg px-3 py-1 text-sm font-semibold text-allow-text">
                A safety check for AI agents that use cameras and voice
              </p>
              <h1 id="hero-title" className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-ink lg:text-[58px]">
                Make sure your AI agent saw the right thing before it acts.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-soft">
                SafeLabs Guard compares what an AI agent sees and hears with your plan. If something is wrong, missing or planted, the agent stops
                instead of acting.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/live" className={btnPrimary}>
                  Try the live agent
                </Link>
                <Link href="/scenarios" className={btnSecondary}>
                  See scenarios
                </Link>
              </div>
              <p className="mt-5 text-xs text-muted lg:whitespace-nowrap">
                Real phone camera · Muse Spark · SAM 3.1 · Muse Voice · Simulated shipment
              </p>
            </div>
            <div className="min-w-0">
              <DemoVideo />
            </div>
          </section>

          {/* Why it matters */}
          <section className={SECTION} aria-label="Why it matters">
            <div className={`${card} sm:p-8`}>
              <p className="text-center text-xs font-bold uppercase tracking-widest text-hold-text">Why it matters</p>
              <div className="mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
                {[
                  { title: "Agents can misread", text: "A model may take one object for another, or miss one completely." },
                  { title: "Hidden orders exist", text: "A sign in the frame or a spoken command can try to steer the agent." },
                  { title: "Mistakes are costly", text: "A wrong action, like shipping the wrong order, is hard to undo." },
                ].map((c) => (
                  <div key={c.title}>
                    <h3 className="text-lg font-bold text-ink">{c.title}</h3>
                    <p className="mt-1.5 text-base text-soft">{c.text}</p>
                  </div>
                ))}
              </div>
              <p className="mt-8 text-center text-base font-semibold text-accent sm:text-lg">
                SafeLabs Guard holds the action until the evidence checks out.
              </p>
            </div>
          </section>

          {/* How it works */}
          <section className={SECTION} aria-labelledby="how-title">
            <Heading
              id="how-title"
              label="How it works"
              title="The guard sits between seeing and doing"
              sub="The agent proposes an action. The guard checks the evidence first. Only a match goes through."
            />
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-nowrap lg:items-stretch">
              <div className={`${card} min-w-0 flex-1`}>
                <div className="flex gap-2">
                  <span className={tile}>
                    <CameraIcon className="h-5 w-5" />
                  </span>
                  <span className={tile}>
                    <MicIcon className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-5 text-xs font-bold uppercase tracking-widest text-muted">Step 1</p>
                <h3 className="mt-1 text-xl font-bold text-ink">See and hear</h3>
                <p className="mt-2 text-base text-soft">
                  The agent reads the camera frame and any voice clip. SAM 3.1, text reading and Muse Voice turn them into plain evidence.
                </p>
              </div>
              <span className="flex shrink-0 items-center justify-center text-2xl text-muted" aria-hidden="true">
                <span className="rotate-90 lg:rotate-0">→</span>
              </span>
              <div className={`${card} card-mint-strong min-w-0 flex-1 bg-allow-bg`}>
                <Image src="/brand/icon.png" alt="" width={48} height={48} className="h-12 w-12" />
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-accent">Step 2</p>
                <h3 className="mt-1 text-xl font-bold text-ink">Check the ledger</h3>
                <p className="mt-2 text-base text-soft">
                  Plain code compares the evidence with the order&apos;s ledger: mug, notebook, cable, seal, ship. No model decides this step.
                </p>
              </div>
              <span className="flex shrink-0 items-center justify-center text-2xl text-muted" aria-hidden="true">
                <span className="rotate-90 lg:rotate-0">→</span>
              </span>
              <div className={`${card} min-w-0 flex-1`}>
                <div className="flex flex-wrap gap-2">
                  <StatusChip kind="ALLOW" />
                  <StatusChip kind="HOLD" />
                </div>
                <p className="mt-5 text-xs font-bold uppercase tracking-widest text-muted">Step 3</p>
                <h3 className="mt-1 text-xl font-bold text-ink">Allow or hold</h3>
                <p className="mt-2 text-base text-soft">
                  A match unlocks the next step. Anything else, or any part unavailable, is held and the action does not run.
                </p>
              </div>
            </div>
          </section>

          {/* The ledger */}
          <section className={SECTION} aria-labelledby="ledger-title">
            <Heading
              id="ledger-title"
              label="The ledger"
              title="One verified step at a time"
              sub="A ledger is a fixed checklist for one order. It says what must be seen, and in what order, before each action is allowed."
            />
            <div className="grid gap-4 lg:grid-cols-3">
              {[
                { label: "What it is", text: "The plan, written down before the agent starts: mug, notebook, cable, seal, then ship." },
                {
                  label: "Why it is needed",
                  text: "An AI model can guess, be fooled or skip ahead. A fixed checklist does not. Plain code compares the evidence with it, so the same input gives the same answer.",
                },
                {
                  label: "Why we use it",
                  text: "Every decision is easy to explain and audit: the agent was allowed, or held, because the ledger said so.",
                },
              ].map((c) => (
                <div key={c.label} className={card}>
                  <p className={capsLabel}>{c.label}</p>
                  <p className="mt-3 text-base text-soft">{c.text}</p>
                </div>
              ))}
            </div>
            <div className={`${card} mt-4 sm:p-8`}>
              <ol className="relative flex flex-col gap-6 lg:grid lg:grid-cols-5 lg:gap-0" aria-label="Order steps">
                <span
                  aria-hidden="true"
                  className="ledger-line absolute left-[10%] right-[10%] top-5 hidden h-0.5 -translate-y-1/2 lg:block"
                />
                {LEDGER_STEPS.map((s) => {
                  const last = s.n === 5;
                  return (
                    <li key={s.n} className="relative flex items-center gap-4 lg:flex-col lg:gap-0 lg:text-center">
                      <span
                        className={`relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-surface text-base font-bold ${
                          last ? "border-pending text-muted" : "border-accent text-accent"
                        }`}
                      >
                        {s.n}
                      </span>
                      <span className="lg:mt-3">
                        <span className="block text-base font-bold text-ink">{s.name}</span>
                        <span className="block text-sm text-muted">{s.note}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>

          {/* The rules */}
          <section className={SECTION} aria-labelledby="checks-title">
            <Heading id="checks-title" label="The rules" title="What the guard checks" />
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  icon: <CheckIcon className="h-6 w-6" />,
                  title: "Right object",
                  text: "The evidence matches the order's ledger, in order. A different mug or a missing cable is a hold.",
                },
                {
                  icon: <AlertIcon className="h-6 w-6" />,
                  title: "Hidden instructions",
                  text: 'Signs in the frame and spoken commands are flagged, so a note saying "ship now" is flagged instead of followed.',
                },
                {
                  icon: <ShieldCheckIcon className="h-6 w-6" />,
                  title: "Fails closed",
                  text: "If any part is down or unsure, the agent holds. Silence is allowed, guessing is not.",
                },
              ].map((c) => (
                <div key={c.title} className={`${card} border-t-[3px] border-t-accent`}>
                  <span className={tile}>{c.icon}</span>
                  <h3 className="mt-4 text-lg font-bold text-ink">{c.title}</h3>
                  <p className="mt-1.5 text-base text-soft">{c.text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* In the demo */}
          <section className={SECTION} aria-labelledby="demo-title">
            <Heading
              id="demo-title"
              label="In the demo"
              title="What you will see"
              sub="Two moments from the recorded run. Same step, different evidence."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <DemoMoment
                accent="hold"
                title="Wrong mug in frame"
                chip="HOLD"
                text="The ledger expects the red mug first. A different mug is in view, so the order does not move forward."
              />
              <DemoMoment
                accent="allow"
                title="Red mug in frame"
                chip="ALLOW"
                text="The camera sees the red mug. The check passes and the ledger unlocks step 2."
              />
            </div>
          </section>

          {/* Honest results */}
          <section className={SECTION} aria-labelledby="results-title">
            <Heading id="results-title" label="Honest results" title="Tested live, with limits" />
            <div className="grid gap-4 md:grid-cols-2">
              <div className={card}>
                <h3 className="text-xl font-bold text-ink">Tested live</h3>
                <ul className="mt-4 space-y-3">
                  {[
                    "Missing items and wrong objects",
                    "Signs in frame with hidden instructions",
                    "Spoken commands",
                    "An extra item at the seal step",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-3 text-base text-soft">
                      <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={card}>
                <h3 className="text-xl font-bold text-ink">Limits</h3>
                <ul className="mt-4 space-y-3">
                  {["The shipment is simulated", "English voice only", "A hackathon demo, not a product"].map((t) => (
                    <li key={t} className="flex items-start gap-3 text-base text-soft">
                      <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-hold-text" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true" focusable="false">
                        <path d="M6 12h12" />
                      </svg>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-muted sm:text-base">
              The agent&apos;s own model often holds by itself. The guard adds fixed rules that do not depend on the model: ledger order, flagged
              instructions and an English-only voice allowlist.
            </p>
          </section>

          {/* FAQ */}
          <section id="faq" className={SECTION} aria-labelledby="faq-title">
            <h2 id="faq-title" className="mb-6 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              FAQ
            </h2>
            <Faq />
          </section>

          {/* Closing call to action */}
          <section className={`${SECTION} cta-band flex flex-col gap-6 rounded-[26px] border p-8 sm:p-10 lg:flex-row lg:items-center lg:justify-between`} aria-label="Try it">
            <div className="min-w-0">
              <h2 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[34px]">Try it with your own camera.</h2>
              <p className="mt-3 max-w-xl text-base text-soft sm:text-lg">
                Show the agent the right and the wrong object and watch what it decides.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/live" className={btnPrimary}>
                Try the live agent
              </Link>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
                View on GitHub ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
