// The author's profile links, shown in the footer's "Built by" card.

export interface SocialLink {
  key: "website" | "linkedin" | "x" | "youtube" | "scholar" | "github";
  /** Accessible name of the icon-only link. */
  label: string;
  href: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { key: "website", label: "Website, waqarjaved.com", href: "https://waqarjaved.com/" },
  { key: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/waqarjaved" },
  { key: "x", label: "X", href: "https://x.com/iamwaqarjaved" },
  { key: "youtube", label: "YouTube", href: "https://www.youtube.com/@iamwaqarjaved" },
  { key: "scholar", label: "Google Scholar", href: "https://scholar.google.com/citations?user=RlD1h5gAAAAJ" },
  { key: "github", label: "GitHub profile", href: "https://github.com/iamwaqarjaved" },
];
