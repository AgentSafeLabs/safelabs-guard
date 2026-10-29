// Link groups for the site footer. Shared by components/SiteFooter.tsx and its
// tests; the external URLs come from links.ts so they are defined once.

import { BLOG_URL, REPO_URL, type NavLink } from "./links";

export interface FooterGroup {
  /** Also the aria-label of the group's <nav>. */
  heading: "Product" | "Resources";
  links: readonly NavLink[];
}

export const FOOTER_GROUPS: readonly FooterGroup[] = [
  {
    heading: "Product",
    links: [
      { href: "/", label: "Home" },
      { href: "/live", label: "Live agent" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: BLOG_URL, label: "Blog", external: true },
      { href: REPO_URL, label: "Source on GitHub", external: true },
    ],
  },
];
