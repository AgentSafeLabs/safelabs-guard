// Hero: live PackProof agent (PASS -> attacked -> BLOCKED).
import BenchmarkBar from "@/components/BenchmarkBar";
import LiveAgent from "@/components/LiveAgent";
import LiveVerification from "@/components/LiveVerification";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-5xl font-black tracking-tight text-white sm:text-6xl">Safelabs Guard</h1>
          <p className="mt-2 text-xl text-zinc-300">
            Stops multimodal agents from being fooled before they act.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            PackProof · ORDER-1042: Red Mug, Blue Notebook, USB-C Cable → Seal → Ship
          </p>
        </header>

        <LiveAgent />

        <LiveVerification />

        <BenchmarkBar />

        <footer className="mt-12 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          Built by Safe Labs AI Inc. Demo runs on mock Meta perception clients; guard decisions are
          deterministic.
        </footer>
      </div>
    </main>
  );
}
