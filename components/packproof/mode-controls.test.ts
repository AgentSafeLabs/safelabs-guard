// Guarded is the default; unguarded sits behind a collapsed disclosure and
// every mode change starts a new run. ModeControls has no hooks, so it is
// called directly and its buttons are found in the returned element tree.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { html, tags, text } from "../../lib/site/test-utils";
import { COMPARE_HELP, COMPARE_LABEL, DEFAULT_MODE, UNGUARDED_BANNER } from "../../lib/client/run-mode";
import type { AgentMode } from "../../lib/agent/types";
import ModeControls from "./ModeControls";

type Props = Parameters<typeof ModeControls>[0];

const base = (over: Partial<Props> = {}): Props => ({
  mode: "guarded",
  busy: false,
  compareOpen: false,
  onToggleCompare: () => {},
  onSwitch: () => {},
  onRestart: () => {},
  ...over,
});

const render = (props: Props) => html(createElement(ModeControls, props));

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : "";
}

function buttons(node: ReactNode, out: ReactElement<{ onClick?: () => void; disabled?: boolean }>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => buttons(n, out));
  else if (isValidElement(node)) {
    if (node.type === "button") out.push(node as ReactElement<{ onClick?: () => void; disabled?: boolean }>);
    buttons((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

const click = (props: Props, label: string) => {
  const found = buttons(ModeControls(props)).find((b) => textOf(b).includes(label));
  expect(found, `button "${label}"`).toBeDefined();
  found!.props.onClick!();
};

describe("ModeControls", () => {
  it("defaults to guarded", () => {
    expect(DEFAULT_MODE).toBe("guarded");
    const markup = render(base());
    expect(text(markup)).not.toContain(UNGUARDED_BANNER);
    expect(text(markup)).not.toContain("Back to guarded");
  });

  it("has no Guarded/Unguarded toggle", () => {
    const markup = render(base({ compareOpen: true }));
    expect(markup).not.toContain('role="radio"');
    expect(markup).not.toContain('role="radiogroup"');
  });

  it("starts with the disclosure collapsed and its content out of the page", () => {
    const markup = render(base());
    const toggle = tags(markup, "button").find((b) => b["aria-controls"] === "compare-panel")!;
    expect(toggle["aria-expanded"]).toBe("false");
    expect(text(markup)).toContain(COMPARE_LABEL);
    expect(text(markup)).not.toContain(COMPARE_HELP);
    expect(text(markup)).not.toContain("Switch to unguarded");
    expect(text(markup)).toContain("Restart run");
  });

  it("opens to the one-line help and the Switch to unguarded button", () => {
    const markup = render(base({ compareOpen: true }));
    const toggle = tags(markup, "button").find((b) => b["aria-controls"] === "compare-panel")!;
    expect(toggle["aria-expanded"]).toBe("true");
    expect(text(markup)).toContain("Runs the same agent with the guard switched off, so you can compare. Changing mode starts a new run.");
    expect(text(markup)).toContain("Switch to unguarded");
  });

  it("asks the page to toggle the disclosure when its button is pressed", () => {
    const onToggleCompare = vi.fn();
    click(base({ onToggleCompare }), COMPARE_LABEL);
    expect(onToggleCompare).toHaveBeenCalledTimes(1);
  });

  it("keeps every control at least 44px tall", () => {
    const markup = render(base({ compareOpen: true }));
    for (const b of tags(markup, "button")) expect(b.class, JSON.stringify(b)).toMatch(/min-h-11/);
    const unguarded = render(base({ mode: "unguarded" }));
    for (const b of tags(unguarded, "button")) expect(b.class).toMatch(/min-h-11/);
  });

  it("requests a new unguarded run from Switch to unguarded", () => {
    const onSwitch = vi.fn<(m: AgentMode) => void>();
    click(base({ compareOpen: true, onSwitch }), "Switch to unguarded");
    expect(onSwitch).toHaveBeenCalledWith("unguarded");
  });

  it("shows the warning banner and Back to guarded when unguarded is active", () => {
    const markup = render(base({ mode: "unguarded" }));
    expect(text(markup)).toContain("Unguarded: the agent executes whatever it proposes");
    expect(text(markup)).toContain("Back to guarded");
  });

  it("restarts in guarded mode from Back to guarded", () => {
    const onSwitch = vi.fn<(m: AgentMode) => void>();
    click(base({ mode: "unguarded", onSwitch }), "Back to guarded");
    expect(onSwitch).toHaveBeenCalledWith("guarded");
  });

  it("restarts the current mode from Restart run", () => {
    const onRestart = vi.fn();
    click(base({ onRestart }), "Restart run");
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("disables the restart and switch controls while a turn is running", () => {
    const tree = ModeControls(base({ mode: "unguarded", busy: true, compareOpen: true }));
    const byLabel = (l: string) => buttons(tree).find((b) => textOf(b).includes(l))!;
    expect(byLabel("Restart run").props.disabled).toBe(true);
    expect(byLabel("Back to guarded").props.disabled).toBe(true);
    expect(byLabel(COMPARE_LABEL).props.disabled).toBeUndefined();
  });
});

describe("PackProofClient wiring", () => {
  const source = readFileSync(join(__dirname, "PackProofClient.tsx"), "utf8");

  it("starts a guarded run and restarts on every mode change", () => {
    expect(source).toContain("startSession(DEFAULT_MODE)");
    expect(source).toContain("onSwitch={switchMode}");
    expect(source).toMatch(/function switchMode\(next: AgentMode\) \{[^}]*resetRun\(next\)/s);
    expect(source).toMatch(/function resetRun\(nextMode: AgentMode\) \{\s*setSession\(startSession\(nextMode\)\);\s*setHistory\(\[\]\)/);
  });

  it("brings the result into view only when a turn finishes, never on Restart run", () => {
    expect(source.match(/setFinishedTurns\(/g)).toHaveLength(1);
    const reset = /function resetRun[\s\S]*?\n  }\n/.exec(source)![0];
    expect(reset).not.toContain("setFinishedTurns");
    expect(source).toMatch(/finally \{[^}]*setSending\(false\);\s*setFinishedTurns/s);
  });
});
