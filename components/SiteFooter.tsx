// Shared footer for /, /live and /scenarios. Server component: plain links and
// text, no client state. Colours come from the tokens in app/globals.css.

import Link from "next/link";
import { ExternalIcon, LogoMark } from "@/components/icons";
import { FOOTER_GROUPS } from "@/lib/nav/footer";

const linkCls =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm text-soft hover:text-accent hover:underline hover:underline-offset-4 focus-visible:text-accent focus-visible:underline focus-visible:underline-offset-4";

export default function SiteFooter() {
  return (
    <footer aria-label="Site footer" className="border-t border-line bg-surface-2">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-14 sm:px-6">
        <div className="grid gap-y-8 md:grid-cols-[minmax(0,360px)_1fr] md:gap-y-4">
          <div className="md:col-start-1 md:row-start-1">
            <p className="flex items-center gap-3 text-base font-bold text-ink">
              <LogoMark />
              <span>Safelabs Guard</span>
            </p>
            <p className="mt-3 text-sm text-muted">Verify what the agent sees before it acts.</p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:justify-end md:gap-x-16">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{group.heading}</h2>
                <ul className="mt-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      {link.external ? (
                        <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkCls}>
                          {link.label}
                          <ExternalIcon className="h-3.5 w-3.5" />
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
            ))}
          </div>

          <p className="inline-flex min-h-8 max-w-full items-center self-start justify-self-start rounded-full border border-line bg-chip px-4 py-1.5 text-sm leading-snug text-soft md:col-start-1 md:row-start-2">
            Built for the Meta Global AI Developer Hackathon
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <p>
            Built by Safe Labs AI Inc. <span aria-hidden="true">·</span> 2026
          </p>
          <p>Shipment is simulated. Hackathon demo.</p>
        </div>
      </div>
    </footer>
  );
}
