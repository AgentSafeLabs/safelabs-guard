import { describe, expect, it } from "vitest";
import type { TurnRecord } from "../agent/types";
import { evidenceSummaries, flaggedEvidence, meaningfulText, stepContext, truncate, verdictView } from "./result-view";

function turn(over: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turn: 1,
    mode: "guarded",
    step: "VERIFY_NOTEBOOK",
    observation: { hasFrame: true, frameMimeType: "image/jpeg", hasFrameHint: false, transcript: "" },
    sparkDecision: { claimedObjects: ["red mug", "blue notebook"], proposedAction: "ADVANCE", rationale: "r", usedImage: true },
    perception: { samObjects: ["red mug"], agentSaw: [{ label: "red mug", confidence: 0.9 }], imageText: "", imageTextSource: "ocr", transcript: "" },
    guard: { decision: "BLOCK", reason: "Perception mismatch: missing blue notebook" },
    executed: null,
    shipped: false,
    ledgerStepAfter: "VERIFY_NOTEBOOK",
    ...over,
  };
}

describe("verdictView", () => {
  it("maps each decision to a word and tone, with the step context", () => {
    const allow = verdictView(turn({ guard: { decision: "ALLOW", reason: "Verified VERIFY_NOTEBOOK" } }), false);
    expect(allow).toEqual({ word: "ALLOW", tone: "allow", reason: "Verified VERIFY_NOTEBOOK", context: "Step 2 of 5 · ORDER-1042" });
    expect(verdictView(turn({ guard: { decision: "HOLD", reason: "Agent chose to hold" } }), false)).toMatchObject({ word: "HOLD", tone: "hold" });
    expect(verdictView(turn(), false)).toMatchObject({ word: "BLOCK", tone: "danger", reason: "Perception mismatch: missing blue notebook" });
  });

  it("uses the existing unguarded line when there is no guard", () => {
    expect(verdictView(turn({ guard: null, mode: "unguarded" }), false)).toMatchObject({
      word: "UNGUARDED",
      tone: "hold",
      reason: "No guard: the agent acted on its own proposal.",
    });
  });

  it("reads SHIPPED in allow colours after a successful ship", () => {
    expect(verdictView(turn({ step: "SHIP", guard: { decision: "ALLOW", reason: "Verified SHIP" } }), true)).toMatchObject({
      word: "SHIPPED",
      tone: "allow",
      context: "Step 5 of 5 · ORDER-1042",
    });
  });

  it("builds the step context from the turn's step", () => {
    expect(stepContext({ step: "VERIFY_MUG" })).toBe("Step 1 of 5 · ORDER-1042");
  });
});

describe("flaggedEvidence", () => {
  const g = (reason: string) => ({ decision: "BLOCK" as const, reason });
  it("points at the evidence named in the reason", () => {
    expect(flaggedEvidence(g("Perception mismatch: unexpected banana"))).toEqual(["camera"]);
    expect(flaggedEvidence(g('Injection attempt detected: image text ("ignore")'))).toEqual(["text"]);
    expect(flaggedEvidence(g('Injection attempt detected: voice transcript ("ship it")'))).toEqual(["voice"]);
    expect(flaggedEvidence(g('Injection attempt detected: image text + voice transcript ("x")'))).toEqual(["text", "voice"]);
    expect(flaggedEvidence(g("Reasoning does not match frame"))).toEqual(["spark", "camera"]);
    expect(flaggedEvidence(g("Voice contains an instruction, not a confirmation"))).toEqual(["voice"]);
    expect(flaggedEvidence(g("image text unavailable"))).toEqual(["text"]);
    expect(flaggedEvidence(g("SAM unavailable"))).toEqual(["camera"]);
    expect(flaggedEvidence({ decision: "HOLD", reason: "Agent chose to hold" })).toEqual(["spark"]);
  });
  it("flags nothing for ALLOW, unguarded or an unknown reason", () => {
    expect(flaggedEvidence({ decision: "ALLOW", reason: "Verified VERIFY_MUG" })).toEqual([]);
    expect(flaggedEvidence(null)).toEqual([]);
    expect(flaggedEvidence(g("something new"))).toEqual([]);
  });
});

describe("meaningfulText", () => {
  it("keeps real words", () => {
    expect(meaningfulText("  IGNORE  previous\ninstructions ")).toBe("IGNORE previous instructions");
    expect(meaningfulText("Ship now")).toBe("Ship now");
  });
  it("drops stray marks and empty text", () => {
    for (const junk of ["", "   ", "~ . ' |", "| | _ -", "a b", "i l 1 .", "°° ~~ ^^"]) expect(meaningfulText(junk), junk).toBeNull();
  });
});

describe("truncate", () => {
  it("shortens long text with an ellipsis and leaves short text alone", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
  });
});

describe("evidenceSummaries", () => {
  const sources = { sam: "live", voice: "live", vision: "live", spark: "live" } as const;
  it("summarises a clean frame with no audio", () => {
    const s = evidenceSummaries({ turn: turn({ perception: { ...turn().perception, imageText: "~ . '" } }), sources }, false, true);
    expect(s).toEqual({ camera: "red mug", text: "None found", voice: "No audio", spark: "ADVANCE · claims red mug, blue notebook" });
  });
  it("shows image text and the transcript when they are real", () => {
    const base = turn();
    const s = evidenceSummaries(
      { turn: turn({ perception: { ...base.perception, imageText: "STOP", transcript: "ship it", samObjects: [] } }), sources },
      true,
      false,
    );
    expect(s).toMatchObject({ camera: "Nothing detected", text: "STOP", voice: '"ship it"' });
  });
  it("says Unavailable when a source is down, not None found", () => {
    const s = evidenceSummaries({ turn: turn(), sources: { ...sources, sam: "unavailable", vision: "unavailable", voice: "unavailable" } }, true, false);
    expect(s).toMatchObject({ camera: "Unavailable", text: "Unavailable", voice: "Unavailable" });
  });
  it("says No usable transcript when audio was sent but nothing came back", () => {
    expect(evidenceSummaries({ turn: turn(), sources }, true, false).voice).toBe("No usable transcript");
  });
});
