// Home: what Safelabs Guard is, how a turn is checked, and the FAQ.
// Server component; the live agent is /live and the mock scenarios /scenarios.
import type { Metadata } from "next";
import Link from "next/link";
import Faq from "@/components/home/Faq";
import Pipeline from "@/components/home/Pipeline";
import {
  AlertIcon,
  BoxIcon,
  CheckIcon,
  EyeIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SparkleIcon,
  XIcon,
} from "@/components/icons";
import ProgressSegments from "@/components/ProgressSegments";
import { BLOG_URL, REPO_URL } from "@/lib/nav/links";
import { STEP_SHORT } from "@/lib/client/progress";

export const metadata: Metadata = {
  title: "Safelabs Guard: verify what the agent sees before it acts",
  description:
    "A deterministic check between a camera and voice agent and its next action. It holds the action when the proposal and the evidence disagree.",
};

const btnPrimary =
  "inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-6 text-base font-bold text-accent-ink hover:brightness-110";
const btnSecondary =
  "inline-flex min-h-12 items-center justify-center rounded-xl border border-line-strong bg-surface px-6 text-base font-semibold text-ink hover:bg-chip";
const card = "rounded-2xl border border-line bg-surface p-5 sm:p-6";
const h2 = "text-2xl font-bold tracking-tight text-ink sm:text-3xl";
const chipCls = "inline-flex min-h-11 items-center rounded-full border border-line bg-chip px-4 text-sm text-soft";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="mt-16 sm:mt-20" aria-labelledby={id}>
      <h2 id={id} className={`${h2} mb-6`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TurnRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <span className="mt-0.5 text-accent">{icon}</span>
      <p className="text-base text-soft">
        <span className="font-semibold text-ink">{label}:</span> {value}
      </p>
    </div>
  );
}

export default function Home() {
  const progress = STEP_SHORT.map((label) => ({ label, state: "done" as const, srText: "verified" }));
  return (
    <main id="content" className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        {/* Hero */}
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]" aria-labelledby="hero-title">
          <div>
            <p className="inline-flex min-h-8 items-center rounded-full border border-allow-border bg-allow-bg px-3 text-sm font-semibold text-allow-text">
              Runtime guardrail for multimodal agents
            </p>
            <h1 id="hero-title" className="mt-5 text-4xl font-black tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Verify what the agent sees before it acts.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-soft">A deterministic check between your agent and its next action.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/live" className={btnPrimary}>
                Try the live agent
              </Link>
              <Link href="/scenarios" className={btnSecondary}>
                See scenarios
              </Link>
            </div>
          </div>
          <div className={`${card} space-y-3`} aria-label="One turn, in short" role="group">
            <h2 className="text-lg font-bold text-ink">One turn, in short</h2>
            <TurnRow icon={<SparkleIcon />} label="Agent proposes" value="Verify the notebook" />
            <TurnRow icon={<EyeIcon />} label="Evidence" value="Frame shows a mug only" />
            <div className="flex items-center gap-3 rounded-xl border border-hold-border bg-hold-bg p-3 text-hold-text">
              <AlertIcon className="h-6 w-6 shrink-0" />
              <p className="text-base">
                <span className="mr-2 font-black tracking-wide">HOLD</span>
                They disagree, so nothing runs.
              </p>
            </div>
          </div>
        </section>

        <Section title="How it works" id="how-title">
          <div className={card}>
            <Pipeline />
          </div>
        </Section>

        <Section title="Same wrong object, two outcomes" id="outcomes-title">
          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className="text-lg font-bold text-ink">Without the guard</h3>
              <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <div className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-3 text-base text-soft">
                  <BoxIcon className="h-6 w-6" />
                  Banana in box
                </div>
                <span className="self-center text-muted" aria-hidden="true">
                  →
                </span>
                <div className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-bg px-3 text-base font-bold text-danger-text">
                  <XIcon className="h-6 w-6" />
                  Advances anyway
                </div>
              </div>
            </div>
            <div className={card}>
              <h3 className="text-lg font-bold text-ink">With Safelabs Guard</h3>
              <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <div className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-3 text-base text-soft">
                  <BoxIcon className="h-6 w-6" />
                  Banana in box
                </div>
                <span className="self-center text-muted" aria-hidden="true">
                  →
                </span>
                <div className="flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl border border-allow-border bg-allow-bg px-3 text-base font-bold text-allow-text">
                  <ShieldIcon className="h-6 w-6" />
                  Held. Not a notebook.
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="What the guard checks" id="checks-title">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: <CheckIcon className="h-6 w-6" />, title: "Right object", text: "Matches the order's ledger." },
              { icon: <AlertIcon className="h-6 w-6" />, title: "Hidden instructions", text: "Signs and spoken commands are flagged." },
              { icon: <ShieldCheckIcon className="h-6 w-6" />, title: "Fails closed", text: "Any part down means hold." },
            ].map((c) => (
              <div key={c.title} className={card}>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-allow-border bg-allow-bg text-accent">
                  {c.icon}
                </span>
                <h3 className="mt-4 text-lg font-bold text-ink">{c.title}</h3>
                <p className="mt-1 text-base text-soft">{c.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="One verified step at a time" id="steps-title">
          <div className={card}>
            <ProgressSegments segments={progress} label="Order steps, all verified" />
          </div>
        </Section>

        <section className="mt-16 grid gap-4 sm:mt-20 md:grid-cols-2" aria-label="Testing and limits">
          <div className={card}>
            <h2 className="text-xl font-bold text-ink">Tested live</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {["Missing items", "Wrong objects", "Signs in frame", "Spoken commands"].map((t) => (
                <li key={t} className={chipCls}>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className={card}>
            <h2 className="text-xl font-bold text-ink">Limits</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {["Shipment simulated", "English voice only", "Hackathon demo"].map((t) => (
                <li key={t} className={chipCls}>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Section title="FAQ" id="faq-title">
          <Faq />
        </Section>

        <footer className="mt-16 border-t border-line pt-6 sm:mt-20">
          <p className="text-sm text-muted">Built by Safe Labs AI Inc.</p>
          <ul className="mt-2 flex flex-wrap gap-x-2">
            {[
              { href: "/live", label: "Live agent", external: false },
              { href: "/scenarios", label: "Scenarios", external: false },
              { href: BLOG_URL, label: "Blog", external: true },
              { href: REPO_URL, label: "Source on GitHub", external: true },
            ].map((l) => (
              <li key={l.href}>
                {l.external ? (
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-soft underline underline-offset-4 hover:text-ink"
                  >
                    {l.label}
                  </a>
                ) : (
                  <Link href={l.href} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-soft underline underline-offset-4 hover:text-ink">
                    {l.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </main>
  );
}
