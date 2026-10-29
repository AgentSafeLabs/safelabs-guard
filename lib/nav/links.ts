// Shared by the nav (client) and the landing page (server). Kept out of the
// "use client" component so server code gets the real string.

export const REPO_URL = "https://github.com/AgentSafeLabs/safelabs-guard";

export const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/packproof", label: "Live agent" },
  { href: "/scenarios", label: "Scenarios" },
];
