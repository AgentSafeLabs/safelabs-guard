// Scripted scenario demo (PASS -> attacked -> BLOCKED), moved here from the
// home page. Perception is mock; the live agent is /live.
import type { Metadata } from "next";
import Link from "next/link";
import BenchmarkBar from "@/components/BenchmarkBar";
import LiveAgent from "@/components/LiveAgent";
import LiveVerification from "@/components/LiveVerification";

export const metadata: Metadata = {
  title: "Scenarios | Safelabs Guard",
  description:
    "Scripted ASI-MM scenarios replayed through the deterministic guard on mock perception clients. Not the live agent.",
};

export default function Scenarios() {
  return (
    <main id="content" className="min-h-screen text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div role="note" className="mb-6 rounded-lg border border-amber-600 bg-amber-950 px-4 py-3 text-sm text-amber-100">
          <strong>Mock perception:</strong> deterministic replay of the guard&apos;s decisions. For the live agent, go to{" "}
          <Link href="/live" className="font-bold underline underline-offset-2">
            /live
          </Link>
          .
        </div>
        <header className="mb-8">
          <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">Safelabs Guard</h1>
          <p className="mt-2 text-xl text-zinc-300">
            Checks what a vision/voice agent proposes against what it sees and hears, and blocks it when they disagree.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            PackProof · ORDER-1042: Red Mug, Blue Notebook, USB-C Cable → Seal → Ship
          </p>
        </header>

        <LiveAgent />

        <LiveVerification />

        <BenchmarkBar />

        <footer className="mt-12 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          Built by Safe Labs AI Inc. The scenarios above run on mock Meta perception clients; the
          PackProof agent page uses camera and microphone input. Guard decisions are deterministic.
        </footer>
      </div>
    </main>
  );
}
