// Shared footer for /, /live and /scenarios. Server component: plain links and
// text, no client state. Colours come from the tokens in app/globals.css.

import Link from "next/link";
import { BLOG_URL, REPO_URL } from "@/lib/nav/links";
import { YOUTUBE_WATCH_URL } from "@/lib/site/demo-video";
import { SOCIAL_LINKS, type SocialLink } from "@/lib/site/socials";

const LINKS: readonly { href: string; label: string; external?: boolean }[] = [
  { href: "/", label: "Home" },
  { href: "/live", label: "Live agent" },
  { href: "/scenarios", label: "Scenarios" },
  { href: YOUTUBE_WATCH_URL, label: "Demo video", external: true },
  { href: BLOG_URL, label: "Blog", external: true },
  { href: REPO_URL, label: "GitHub", external: true },
];

const linkCls =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-base font-semibold text-ink hover:text-accent hover:underline hover:underline-offset-4 focus-visible:text-accent focus-visible:underline focus-visible:underline-offset-4";

const FILLED: Record<string, string> = {
  linkedin:
    "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  youtube:
    "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
};

const STROKED: Record<string, string> = {
  website: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18",
  scholar: "M12 4 2 9l10 5 10-5-10-5zM6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v6",
};

function SocialIcon({ name }: { name: SocialLink["key"] }) {
  const fill = FILLED[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden="true"
      focusable="false"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={fill ?? STROKED[name]} />
    </svg>
  );
}

export default function SiteFooter() {
  return (
    <footer aria-label="Site footer" className="border-t border-line bg-surface-2">
      <div className="mx-auto max-w-[1200px] px-8 pb-8 pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-[72px]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/stacked.png"
              srcSet="/brand/stacked.png 640w, /brand/stacked@2x.png 1100w"
              sizes="260px"
              width={640}
              height={770}
              alt="SafeLabs Guard"
              className="h-auto w-[200px] lg:w-[260px]"
            />
          </div>

          <div className="min-w-0 space-y-6">
            <nav aria-label="Footer" className="border-b border-line pb-3">
              <ul className="flex flex-wrap items-center gap-x-7 gap-y-1">
                {LINKS.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkCls}>
                        {link.label}
                        <span aria-hidden="true"> ↗</span>
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={link.href} className={linkCls}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex flex-col gap-5 rounded-[18px] border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-accent">Built by</p>
                <p className="mt-1.5 text-[22px] font-bold leading-tight text-ink">Waqar Javed</p>
                <p className="mt-1 text-sm text-muted">Founder, Safe Labs AI Inc.</p>
              </div>
              <ul className="flex flex-wrap gap-2.5" aria-label="Profiles">
                {SOCIAL_LINKS.map((s) => (
                  <li key={s.key}>
                    <a
                      href={s.href}
                      aria-label={s.label}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-chip text-soft hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent"
                    >
                      <SocialIcon name={s.key} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <p className="inline-flex min-h-8 max-w-full items-center rounded-full border border-line bg-chip px-4 py-1.5 text-sm leading-snug text-soft">
              Built for the Meta Global AI Developer Hackathon
            </p>
          </div>
        </div>

        <p className="mt-10 border-t border-line pt-6 text-center text-sm text-muted">
          © 2026 SafeLabs Guard <span aria-hidden="true">·</span> Built by Waqar Javed, Founder, Safe Labs AI Inc.
        </p>
      </div>
    </footer>
  );
}
