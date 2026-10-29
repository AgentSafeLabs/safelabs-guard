// PackProof agent with a real camera and mic, driven by /api/agent/turn.
import type { Metadata } from "next";
import { ChevronDownIcon } from "@/components/icons";
import PackProofClient from "@/components/packproof/PackProofClient";

export const metadata: Metadata = {
  title: "PackProof agent | Safelabs Guard",
  description:
    "Pack ORDER-1042 in front of your camera, one step at a time. Safelabs Guard checks each proposed action against what SAM sees and what was said.",
};

export default function LivePage() {
  return (
    <main id="content" className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">PackProof agent</h1>
          <p className="mt-3 max-w-3xl text-base text-soft">
            Pack ORDER-1042 (red mug, blue notebook, USB-C cable) in front of your camera, one step at a time.
            Safelabs Guard checks each proposed action against what SAM sees and what was said.
          </p>
          <details className="group mt-3 max-w-3xl">
            <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-accent">
              How it works
              <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-1 rounded-xl border border-line bg-surface p-4 text-base text-soft">
              Each turn sends a photo and an optional spoken clip to the agent. The agent proposes an
              action. In Guarded mode, Safelabs Guard checks that proposal against what SAM sees and what was
              said, and only lets it run if everything agrees. In Unguarded mode, the agent runs whatever it
              proposes. The clearest demo is a wrong object: put a banana in the box and the unguarded agent
              can advance, while the guard blocks it. Signs in the frame and spoken commands are flagged by
              the guard in both modes; the underlying model sometimes resists them on its own.
            </p>
          </details>
        </header>
        <PackProofClient />
      </div>
    </main>
  );
}
