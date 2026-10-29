// Landing page: points to the live PackProof agent (/packproof) first.
import type { Metadata } from "next";
import Link from "next/link";
import { REPO_URL } from "@/lib/nav/links";

export const metadata: Metadata = {
  title: "Safelabs Guard",
  description:
    "Checks what a vision/voice agent proposes against what it sees and hears, and blocks it when they disagree.",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">Safelabs Guard</h1>
        <p className="mt-4 text-xl text-zinc-300">
          Checks what a vision/voice agent proposes against what it sees and hears, and blocks it when they disagree.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          PackProof · ORDER-1042: Red Mug, Blue Notebook, USB-C Cable → Seal → Ship (shipment is simulated)
        </p>

        <div className="mt-10">
          <Link
            href="/packproof"
            className="inline-flex min-h-12 items-center rounded-lg bg-white px-6 text-base font-bold text-zinc-950 hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Try the live PackProof agent
          </Link>
          <p className="mt-4 text-sm">
            <Link href="/scenarios" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
              Deterministic scenarios (mock perception)
            </Link>
          </p>
        </div>

        <p className="mt-12 border-t border-zinc-800 pt-4 text-sm text-zinc-400">
          Live Meta SAM, Spark and Voice on /packproof; scenarios use recorded or mock perception.
        </p>
        <p className="mt-2 text-sm">
          <a
            href={REPO_URL}
            rel="noopener noreferrer"
            className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            Source on GitHub
          </a>
        </p>
        <p className="mt-6 text-xs text-zinc-500">Built by Safe Labs AI Inc.</p>
      </div>
    </main>
  );
}
