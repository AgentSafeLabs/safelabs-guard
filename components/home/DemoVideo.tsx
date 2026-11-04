"use client";

// Demo video card. Nothing from YouTube loads until the poster button is
// pressed; then the poster is replaced by a privacy-enhanced embed in the same
// 16:9 frame and focus moves to it.

import Image from "next/image";
import { useEffect, useRef, useState, type Ref } from "react";
import { YOUTUBE_EMBED_URL, YOUTUBE_WATCH_URL } from "@/lib/site/demo-video";

/** Presentational: the frame in its poster or playing state. */
export function DemoVideoFrame({ playing, onPlay, iframeRef }: { playing: boolean; onPlay?: () => void; iframeRef?: Ref<HTMLIFrameElement> }) {
  if (playing) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <iframe
          ref={iframeRef}
          src={YOUTUBE_EMBED_URL}
          title="SafeLabs Guard demo video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label="Play the 3 minute demo here"
      className="group relative block aspect-video w-full overflow-hidden rounded-xl bg-surface-2"
    >
      <Image
        src="/brand/demo-poster-explainer.jpg"
        alt=""
        width={1280}
        height={720}
        priority
        sizes="(min-width: 1280px) 520px, (min-width: 1024px) 42vw, 100vw"
        className="h-full w-full object-cover"
      />
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-transform group-hover:scale-105"
      >
        <svg viewBox="0 0 24 24" width={34} height={34} fill="currentColor" focusable="false">
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
        </svg>
      </span>
      <span aria-hidden="true" className="absolute bottom-3 right-3 rounded-md bg-black/75 px-2 py-0.5 text-sm font-semibold text-white">
        3:00
      </span>
    </button>
  );
}

export default function DemoVideo() {
  const [playing, setPlaying] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (playing) iframe.current?.focus();
  }, [playing]);

  return (
    <div className="card-mint rounded-[20px] border p-3 sm:p-4">
      <DemoVideoFrame playing={playing} onPlay={() => setPlaying(true)} iframeRef={iframe} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1 pb-1">
        <div className="min-w-0">
          <p className="text-lg font-bold text-ink">Watch the 3-minute demo</p>
          <p className="mt-0.5 text-sm text-muted">A packing agent, a real phone camera, five checks. Plays right here.</p>
        </div>
        <a
          href={YOUTUBE_WATCH_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-accent hover:underline hover:underline-offset-4"
        >
          Open on YouTube ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}
