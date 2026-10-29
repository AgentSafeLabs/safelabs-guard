// Shared by the nav (client) and the pages (server). Kept out of the
// "use client" component so server code gets the real string.

export const REPO_URL = "https://github.com/AgentSafeLabs/safelabs-guard";
export const BLOG_URL = "https://agentsafelabs.com/blog/";

export interface NavLink {
  href: string;
  label: string;
  /** Opens another site in a new tab. */
  external?: boolean;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/live", label: "Live agent" },
  { href: "/scenarios", label: "Scenarios" },
  { href: BLOG_URL, label: "Blog", external: true },
  { href: REPO_URL, label: "GitHub", external: true },
];

/** True when `href` is the page at `pathname`. External links are never current. */
export function isCurrent(pathname: string | null, link: NavLink): boolean {
  if (link.external || pathname === null) return false;
  return pathname === link.href;
}
