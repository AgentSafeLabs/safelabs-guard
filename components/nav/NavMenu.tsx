"use client";

// Nav links (desktop row) and the mobile menu. Client-side because it needs
// the current path (aria-current) and the menu's open state.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ExternalIcon, MenuIcon, XIcon } from "@/components/icons";
import { isCurrent, NAV_LINKS, type NavLink } from "@/lib/nav/links";
import { nextMenuOpen, type MenuEvent } from "@/lib/nav/menu";

const PANEL_ID = "mobile-nav-panel";

function NavAnchor({ link, pathname, className, onClick }: { link: NavLink; pathname: string | null; className: string; onClick?: () => void }) {
  const current = isCurrent(pathname, link);
  const inner = (
    <>
      {link.label}
      {link.external && <ExternalIcon className="h-3.5 w-3.5" />}
    </>
  );
  const cls = `${className} ${current ? "bg-chip font-bold text-ink" : "text-soft hover:text-ink"}`;
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls} onClick={onClick}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={link.href} aria-current={current ? "page" : undefined} className={cls} onClick={onClick}>
      {inner}
    </Link>
  );
}

/** Presentational: takes the path as a prop so it renders without the router. */
export function NavMenuView({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const update = (event: MenuEvent) => setOpen((o) => nextMenuOpen(o, event));

  useEffect(() => {
    update("route-change");
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        update("escape");
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <ul className="hidden items-center gap-1 md:flex" data-nav="desktop">
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <NavAnchor link={link} pathname={pathname} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm" />
          </li>
        ))}
      </ul>
      <button
        ref={button}
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => update("toggle")}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-ink md:hidden"
      >
        {open ? <XIcon /> : <MenuIcon />}
      </button>
      <ul
        id={PANEL_ID}
        hidden={!open}
        data-nav="mobile"
        className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface px-4 py-2 shadow-lg md:hidden"
      >
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <NavAnchor
              link={link}
              pathname={pathname}
              className="flex min-h-12 items-center gap-2 rounded-lg px-3 text-base"
              onClick={() => update("link-click")}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

export default function NavMenu() {
  return <NavMenuView pathname={usePathname()} />;
}
