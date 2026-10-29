"use client";

// Site-wide navigation, rendered once from app/layout.tsx.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, REPO_URL } from "@/lib/nav/links";

const linkClass =
  "inline-flex min-h-11 items-center rounded px-3 text-sm font-medium text-zinc-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100 aria-[current=page]:bg-zinc-800 aria-[current=page]:text-white";

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 px-2 sm:px-4">
        <Link
          href="/"
          aria-current={pathname === "/" ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded px-2 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100"
        >
          Safelabs Guard
        </Link>
        <ul className="flex flex-wrap items-center">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} aria-current={pathname === href ? "page" : undefined} className={linkClass}>
                {label}
              </Link>
            </li>
          ))}
          <li>
            <a href={REPO_URL} rel="noopener noreferrer" className={linkClass}>
              GitHub
            </a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
