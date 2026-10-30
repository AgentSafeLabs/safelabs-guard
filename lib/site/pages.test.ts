// /scenarios and /live pages, plus the claims scan over all three routes.

import { describe, expect, it } from "vitest";
import Home, { metadata as homeMetadata } from "../../app/page";
import Live, { metadata as liveMetadata } from "../../app/live/page";
import Scenarios, { metadata as scenariosMetadata } from "../../app/scenarios/page";
import { ALSO_BANNED, BANNED, BENCHMARK_OUTPUT, COUNTED_RESULT, flat, render, tags, text } from "./test-utils";

describe("/scenarios", () => {
  const page = render(Scenarios);

  it("shows the mock-perception banner pointing at /live", () => {
    const banner = /<div role="note"[^>]*>(.*?)<\/div>/s.exec(page)?.[1] ?? "";
    expect(flat(banner)).toContain("Mock perception: deterministic replay of the guard's decisions. For the live agent, go to /live.");
    expect(tags(banner, "a").map((a) => a.href)).toEqual(["/live"]);
  });

  it("keeps the scenario demo components", () => {
    expect(text(page)).toContain("SAM 3.1 (mock)");
  });

  it("has its own title", () => {
    expect(String(scenariosMetadata.title)).toBe("Scenarios | Safelabs Guard");
  });
});

describe("/live", () => {
  const page = render(Live);
  const copy = text(page);

  it("has the PackProof agent title and heading", () => {
    expect(String(liveMetadata.title)).toBe("PackProof agent | Safelabs Guard");
    expect(page).toMatch(/<h1[^>]*>PackProof agent<\/h1>/);
  });

  it("has the short intro and keeps the long text under How it works", () => {
    expect(copy).toContain(
      "Pack ORDER-1042 (red mug, blue notebook, USB-C cable) in front of your camera, one step at a time. Safelabs Guard checks each proposed action against what SAM sees and what was said.",
    );
    const how = /<details[^>]*>\s*<summary[^>]*>\s*How it works.*?<\/details>/s.exec(page)?.[0] ?? "";
    expect(how).not.toBe("");
    expect(text(how)).toContain("put a banana in the box and the unguarded agent can advance, while the guard blocks it");
    expect(text(how)).toContain("Signs in the frame and spoken commands are flagged by the guard in both modes; the underlying model sometimes resists them on its own.");
  });

  it("starts at Step 1 of 5 with the progress card", () => {
    expect(copy).toContain("Step 1 of 5 · Verify the mug");
    expect(copy).toContain("Next: Verify the notebook");
    expect(page).toContain('aria-current="step"');
    expect(page).toContain('aria-label="Order steps"');
    for (const l of ["Mug", "Notebook", "Cable", "Seal", "Ship"]) expect(copy).toContain(l);
  });

  it("defaults to guarded, with the unguarded mode behind a collapsed disclosure next to Restart run", () => {
    const radios = tags(page, "button").filter((b) => b.role === "radio");
    expect(radios.map((r) => r["aria-checked"])).toEqual(["true", "false"]); // input source only; no mode toggle
    expect(page).not.toContain('aria-label="Agent mode"');
    const disclosure = tags(page, "button").find((b) => b["aria-expanded"] !== undefined && b["aria-controls"] === "compare-panel")!;
    expect(disclosure["aria-expanded"]).toBe("false");
    expect(copy).toContain("Compare without the guard");
    expect(copy).toContain("Restart run");
    expect(copy).toContain("Send turn (guarded)");
    expect(copy).not.toContain("Switch to unguarded");
    expect(copy).not.toContain("Unguarded: the agent executes whatever it proposes");
    expect(copy).not.toContain("Back to guarded");
  });

  it("has the input toggle and the empty viewport", () => {
    expect(copy).toContain("Live camera");
    expect(copy).toContain("Upload image");
    expect(copy).toContain("No input yet");
    expect(copy).toContain("Ready when you are");
    expect(copy).toContain("Start the camera and point it at the items you are packing. Nothing is recorded until you capture a frame.");
    expect(copy).toContain("Start camera");
    expect(copy).toContain("Use live camera");
    expect(copy).toContain("Upload an image");
  });

  it("has the voice card, a disabled Send and the empty result", () => {
    expect(copy).toContain("Voice (optional)");
    expect(copy).toContain("Only what the server transcribes from this clip is used.");
    const send = tags(page, "button").find((b) => b.class?.includes("min-h-[52px]"))!;
    expect(send).toBeDefined();
    expect(send.disabled).toBeDefined();
    expect(copy).toContain("Send turn (guarded)");
    expect(copy).toContain("Capture a frame or choose a test image first.");
    expect(copy).toContain("No turns yet");
    expect(copy).toContain("Start the camera, capture a frame, then send a turn. The verdict and evidence appear here.");
  });

  it("has the Ship panel disabled with its helper", () => {
    expect(copy).toContain("Ship order");
    expect(copy).toContain("Enabled only after the guard ALLOWs SHIP.");
  });

  it("uses a two-column layout with a 420px result column from 1024px", () => {
    expect(page).toContain("lg:grid-cols-[minmax(0,1fr)_420px]");
  });
});

describe("claims on the rendered pages", () => {
  const PAGES: [route: string, render: () => string][] = [
    ["/", () => render(Home)],
    ["/live", () => render(Live)],
    ["/scenarios", () => render(Scenarios)],
  ];
  for (const [route, draw] of PAGES) {
    for (const [name, pattern] of [...BANNED, ...ALSO_BANNED]) {
      it(`${route} does not contain "${name}"`, () => {
        const copy = text(draw()).replace(COUNTED_RESULT, "").replace(BENCHMARK_OUTPUT, "");
        expect(copy).not.toMatch(pattern);
      });
    }
  }

  it("metadata carries no banned claim", () => {
    for (const m of [homeMetadata, liveMetadata, scenariosMetadata]) {
      const copy = `${String(m.title)} ${String(m.description ?? "")}`;
      for (const [name, pattern] of [...BANNED, ...ALSO_BANNED]) expect(copy, name).not.toMatch(pattern);
    }
  });
});
