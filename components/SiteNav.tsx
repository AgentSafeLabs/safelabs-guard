// Site-wide navigation, rendered once from app/layout.tsx. The logo and the
// landmark are server-rendered; only the link list and the mobile menu need
// the current path and open/closed state, so they live in NavMenu (client).

import Link from "next/link";
import { LogoMark } from "@/components/icons";
import NavMenu from "@/components/nav/NavMenu";

export default function SiteNav() {
  return (
    <header className="border-b border-line bg-page">
      <nav aria-label="Main" className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-3 rounded-lg pr-2 text-base font-bold text-ink">
          <LogoMark />
          <span>Safelabs Guard</span>
        </Link>
        <NavMenu />
      </nav>
    </header>
  );
}
