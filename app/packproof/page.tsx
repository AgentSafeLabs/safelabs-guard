// PackProof agent with a real camera and mic, driven by /api/agent/turn.
import PackProofClient from "@/components/packproof/PackProofClient";

export const metadata = {
  title: "PackProof agent · Safelabs Guard",
};

export default function PackProofPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">PackProof agent</h1>
          <p className="mt-3 max-w-3xl text-zinc-300">
            Pack ORDER-1042 (red mug, blue notebook, USB-C cable) in front of your camera, one step at a
            time. Each turn sends a photo and an optional spoken clip to the agent. The agent proposes an
            action. In Guarded mode, Safelabs Guard checks that proposal against what SAM sees and what was
            said, and only lets it run if everything agrees. In Unguarded mode, the agent runs it anyway. A
            sign in the frame or a spoken &ldquo;ship it now&rdquo; can make the unguarded agent ship early;
            the guarded one blocks it.
          </p>
        </header>
        <PackProofClient />
      </div>
    </main>
  );
}
