// Open/closed state of the mobile menu as a pure function, so the rules are
// unit-tested without a DOM.

export type MenuEvent = "toggle" | "escape" | "link-click" | "route-change";

export function nextMenuOpen(open: boolean, event: MenuEvent): boolean {
  if (event === "toggle") return !open;
  return false;
}
