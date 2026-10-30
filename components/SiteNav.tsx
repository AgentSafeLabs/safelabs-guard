// Site-wide navigation, rendered once from app/layout.tsx. The logo and the
// landmark are server-rendered; only the link list and the mobile menu need
// the current path and open/closed state, so they live in NavMenu (client).

import Link from "next/link";
import NavMenu from "@/components/nav/NavMenu";

export default function SiteNav() {
  return (
    <header className="border-b border-line bg-page">
      <nav aria-label="Main" className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/wordmark.png"
            srcSet="/brand/wordmark.png 900w, /brand/wordmark@2x.png 1800w"
            sizes="(min-width: 640px) 213px, 164px"
            width={900}
            height={220}
            alt="Safelabs Guard"
            className="h-10 w-auto sm:h-[52px]"
          />
        </Link>
        <NavMenu />
      </nav>
    </header>
  );
}
