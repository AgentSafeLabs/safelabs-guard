// Result box and ship panel rendered with fixture turns (static HTML).

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { APPROVAL_TTL_SECONDS } from "../../lib/agent/approval";
import type { TurnResponse } from "../../lib/client/agent-api";
import { html, tags, text } from "../../lib/site/test-utils";
import ResultPanel from "./ResultPanel";
import ShipPanel, { APPROVAL_MINUTES } from "./ShipPanel";
import type { HistoryEntry } from "./types";

function response(over: Partial<TurnResponse["turn"]> = {}, extra: Partial<TurnResponse> = {}): TurnResponse {
  return {
    turn: {
      turn: 1,
      mode: "guarded",
      step: "VERIFY_NOTEBOOK",
      observation: { hasFrame: true, frameMimeType: "image/jpeg", hasFrameHint: false, transcript: "" },
      sparkDecision: { claimedObjects: ["red mug", "blue notebook"], proposedAction: "ADVANCE", rationale: "looks right", usedImage: true },
      perception: { samObjects: ["red mug"], agentSaw: [{ label: "red mug", confidence: 0.91 }], imageText: "~ . '", imageTextSource: "ocr", transcript: "" },
      guard: { decision: "BLOCK", reason: "Perception mismatch: missing blue notebook" },
      executed: null,
      shipped: false,
      ledgerStepAfter: "VERIFY_NOTEBOOK",
      ...over,
    },
    session: "tok",
    ledger: { step: "VERIFY_NOTEBOOK", stepIndex: 1, status: "IN_PROGRESS" },
    shipped: false,
    sources: { sam: "live", voice: "live", vision: "live", spark: "live" },
    perceptionDetail: { voice: "voice not sent" },
    ...extra,
  };
}

const entry = (r: TurnResponse, id = 1, hadAudio = false): HistoryEntry => ({ id, at: "10:00:00", response: r, hadAudio });
const panel = (history: HistoryEntry[], over: { sending?: boolean; waited?: number; shipResult?: never } = {}) =>
  html(createElement(ResultPanel, { history, sending: false, waited: 0, shipResult: null, ...over }));

describe("ResultPanel", () => {
  it("shows the empty state before any turn", () => {
    const t = text(panel([]));
    expect(t).toContain("No turns yet");
    expect(t).toContain("Start the camera, capture a frame, then send a turn. The verdict and evidence appear here.");
  });

  it("shows a skeleton and Checking frame... in a polite live region while sending", () => {
    const markup = panel([entry(response())], { sending: true, waited: 12 });
    expect(markup).toMatch(/aria-live="polite"/);
    expect(text(markup)).toContain("Checking frame...");
    expect(text(markup)).toContain("12 s");
    expect(text(markup)).not.toContain("BLOCK");
  });

  it("shows a BLOCK banner with an X icon, a word, the reason and the step context", () => {
    const markup = panel([entry(response())]);
    const t = text(markup);
    expect(t).toContain("Step 2 of 5 · ORDER-1042");
    expect(t).toContain("BLOCK");
    expect(t).toContain("Perception mismatch: missing blue notebook");
    expect(markup).toContain("border-danger-border");
    expect(markup).toContain('d="M6 6l12 12M18 6L6 18"');
  });

  it("shows ALLOW and HOLD in their own colours with a check and a '!' icon", () => {
    const allow = panel([entry(response({ guard: { decision: "ALLOW", reason: "Verified VERIFY_NOTEBOOK" } }))]);
    expect(text(allow)).toContain("ALLOW");
    expect(allow).toContain("border-allow-border");
    expect(allow).toContain('d="M5 12.5l4.5 4.5L19 7.5"');
    const hold = panel([entry(response({ guard: { decision: "HOLD", reason: "Agent chose to hold" } }))]);
    expect(text(hold)).toContain("HOLD");
    expect(hold).toContain("border-hold-border");
    expect(hold).toContain('d="M12 7.5v5.5M12 16.5h.01"');
  });

  it("shows SHIPPED in allow colours once shipped", () => {
    const r = response({ step: "SHIP", guard: { decision: "ALLOW", reason: "Verified SHIP" } }, { approval: "a" });
    const markup = panel([entry(r)], { shipResult: { shipment: { shipmentId: "SHP-1", orderId: "ORDER-1042", createdAt: "x" }, status: "shipment" } as never });
    expect(text(markup)).toContain("SHIPPED");
    expect(text(markup)).toContain("Shipped. Repeating this approval returns the same shipment.");
  });

  it("does not show SHIPPED on a later turn that carries no approval", () => {
    const markup = panel([entry(response())], { shipResult: { shipment: { shipmentId: "SHP-1", orderId: "o", createdAt: "x" }, status: "shipment" } as never });
    expect(text(markup)).not.toContain("SHIPPED");
  });

  it("shows four evidence cards, flags the one behind the stop, and keeps raw text in Details", () => {
    const markup = panel([entry(response())]);
    const t = text(markup);
    for (const title of ["What the camera saw", "Text in the image", "What was heard", "Spark proposed"]) expect(t).toContain(title);
    expect(t).toContain("None found"); // junk OCR is not shown as a summary
    expect(t).toContain("No audio");
    expect(t).toContain('"~ . \'"'); // raw text still inside Details
    const flagged = tags(markup, "div").filter((d) => d["data-flagged"] === "true");
    expect(flagged).toHaveLength(1);
    expect(markup).toMatch(/data-flagged="true"[^>]*>\s*<h3[^>]*>What the camera saw/);
  });

  it("keeps the source badges and unavailable reasons", () => {
    const r = response({}, { sources: { sam: "unavailable", voice: "live", vision: "live", spark: "live" }, perceptionDetail: { sam: "sam timeout" as never, voice: "voice not sent" } });
    const t = text(panel([entry(r)]));
    expect(t).toContain("SAM: UNAVAILABLE");
    expect(t).toContain("VOICE: NOT SENT");
    expect(t).toContain("Why unavailable: sam: sam timeout");
  });

  it("shows NOT CONSULTED for sources a pre-perception BLOCK never asked, and UNAVAILABLE for the one that failed", () => {
    const r = response(
      { guard: { decision: "BLOCK", reason: "voice unavailable" } },
      {
        sources: { sam: "unavailable", voice: "unavailable", vision: "unavailable", spark: "unavailable" },
        perceptionDetail: {
          sam: "not consulted: perception failed closed",
          vision: "not consulted: perception failed closed",
          spark: "spark not consulted: perception failed closed",
          voice: "voice timeout",
        },
      },
    );
    const t = text(panel([entry(r, 1, true)]));
    expect(t).toContain("SAM: NOT CONSULTED");
    expect(t).toContain("IMAGE TEXT: NOT CONSULTED");
    expect(t).toContain("SPARK: NOT CONSULTED");
    expect(t).toContain("VOICE: UNAVAILABLE");
    expect(t).not.toContain("SAM: UNAVAILABLE");
    expect(t).toContain("Why unavailable: voice: voice timeout");
    expect(t).not.toContain("Why unavailable: sam");
  });

  it("shows UNAVAILABLE for sources that were tried and failed", () => {
    const r = response({}, {
      sources: { sam: "unavailable", voice: "live", vision: "unavailable", spark: "unavailable" },
      perceptionDetail: { sam: "sam timeout", vision: "ocr error", spark: "spark timeout", voice: "voice not sent" },
    });
    const t = text(panel([entry(r)]));
    expect(t).toContain("SAM: UNAVAILABLE");
    expect(t).toContain("IMAGE TEXT: UNAVAILABLE");
    expect(t).toContain("SPARK: UNAVAILABLE");
    expect(t).not.toContain("NOT CONSULTED");
  });

  it("says No readable text for noisy OCR and keeps the raw text under Unreadable text found", () => {
    const noisy = "Na di . rR! > W< '§ > | C BI } a == LHL IRs — J Ing = —) V4 Seta Xs | 8";
    const markup = panel([entry(response({ perception: { ...response().turn.perception, imageText: noisy } }))]);
    const t = text(markup);
    expect(t).toContain("No readable text");
    expect(t).toContain("Unreadable text found");
    expect(t).toContain(noisy);
    const card = /<h3[^>]*>Text in the image.*?<\/details>/s.exec(markup)![0];
    expect(card).toMatch(/<summary[^>]*>\s*Details/);
    expect(card.indexOf("No readable text")).toBeLessThan(card.indexOf("<details"));
    expect(card.indexOf("Unreadable text found")).toBeGreaterThan(card.indexOf("<details"));
  });

  it("never collapses noisy text the guard flagged as an injection", () => {
    const noisy = "Na di . rR! > W< '§ > | C BI } a == LHL IRs — J Ing = —) V4 Seta Xs | 8";
    const r = response(
      {
        perception: { ...response().turn.perception, imageText: noisy },
        guard: { decision: "BLOCK", reason: "Injection attempt detected: image text (ignore previous)" },
      },
      { securityEvents: [{ kind: "injection", source: "image", excerpt: "ignore", shadow: false }] },
    );
    const markup = panel([entry(r)]);
    const card = /<h3[^>]*>Text in the image.*?<\/details>/s.exec(markup)![0];
    expect(text(card)).not.toContain("No readable text");
    expect(text(card)).not.toContain("Unreadable text found");
    expect(card.indexOf("Na di")).toBeLessThan(card.indexOf("<details"));
    expect(card).toContain("(caused the stop)");
  });

  it("has a focusable result heading and a polite status line", () => {
    const markup = panel([entry(response())]);
    expect(markup).toMatch(/<h2[^>]*tabindex="-1"[^>]*>Result<\/h2>/);
    expect(markup).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*>Turn 1: BLOCK\./);
  });

  it("shows the shadow note in amber for an unguarded turn", () => {
    const r = response(
      { mode: "unguarded", guard: null, executed: "ADVANCE" },
      { securityEvents: [{ kind: "injection", source: "image", excerpt: "ignore the rules", shadow: true }] },
    );
    const markup = panel([entry(r)]);
    expect(text(markup)).toContain("Guard detected an injection attempt in image text (shadow: the guard would have flagged this)");
    expect(markup).toMatch(/role="alert"[^>]*border-hold-border|border-hold-border[^>]*role="alert"/);
    expect(text(markup)).toContain("UNGUARDED");
  });

  it("collapses older turns under Earlier turns", () => {
    const markup = panel([entry(response(), 2), entry(response({ turn: 1 }), 1)]);
    expect(text(markup)).toContain("Earlier turns (1)");
    expect(panel([entry(response())])).not.toContain("Earlier turns");
  });
});

describe("ShipPanel", () => {
  const shipped = { shipment: { shipmentId: "SHP-ABC123", orderId: "ORDER-1042", createdAt: "2026-10-29T10:00:00.000Z" }, status: "shipment" as const };

  it("is disabled until there is an approval", () => {
    const markup = html(createElement(ShipPanel, { approval: null, shipResult: null, busy: false, onShip: () => {} }));
    expect(tags(markup, "button")[0].disabled).toBeDefined();
    expect(text(markup)).toContain("Enabled only after the guard ALLOWs SHIP.");
    const ready = html(createElement(ShipPanel, { approval: "a", shipResult: null, busy: false, onShip: () => {} }));
    expect(tags(ready, "button")[0].disabled).toBeUndefined();
  });

  it("shows the shipment id, a 44px copy button, the repeat note and the 5-minute note", () => {
    const markup = html(createElement(ShipPanel, { approval: "a", shipResult: shipped, busy: false, onShip: () => {} }));
    const t = text(markup);
    expect(t).toContain("SHP-ABC123");
    expect(t).toContain("Shipped. Repeating this approval returns the same shipment.");
    expect(t).toContain("The approval is valid for 5 minutes.");
    const copy = tags(markup, "button").find((b) => b["aria-label"] === "Copy shipment ID")!;
    expect(copy.class).toContain("h-11");
    expect(copy.class).toContain("w-11");
    expect(markup).toMatch(/font-mono[^>]*break-all|break-all[^>]*font-mono/);
  });

  it("states the approval lifetime the server uses", () => {
    expect(APPROVAL_MINUTES * 60).toBe(APPROVAL_TTL_SECONDS);
  });
});
