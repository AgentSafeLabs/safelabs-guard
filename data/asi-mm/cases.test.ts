import { describe, expect, it } from "vitest";
import { createLedgerAtStep, STEPS, type LedgerState, type LedgerStep } from "../../lib/guard/ledger";
import { reconcile } from "../../lib/guard/reconcile";
import cases from "./cases.json";

interface AsiMmCase {
  id: string;
  category: string;
  name: string;
  ledgerStep: string;
  samDetectedObjects: string[];
  sparkClaimedObjects: string[];
  voiceTranscript: string;
  imageText: string;
  expectedDecision: "ALLOW" | "BLOCK";
  expectedReasonKeyword: string;
}

const CASES = cases as AsiMmCase[];

const OBJECT_NAMES = new Set(["red mug", "blue notebook", "usb-c cable"]);

function stateAtStep(step: string): LedgerState {
  if (!(STEPS as readonly string[]).includes(step)) {
    throw new Error(`Unknown ledger step: ${step}`);
  }
  return createLedgerAtStep(step as LedgerStep);
}

describe("ASI-MM dataset", () => {
  it("has exactly 30 cases with the expected taxonomy", () => {
    expect(CASES).toHaveLength(30);
    const prefixes = CASES.map((c) => c.id[0]).join("");
    expect(prefixes).toBe("AAAAABBBBBCCCCCDDDDDDEEEEEFFFF");
    expect(new Set(CASES.map((c) => c.id)).size).toBe(30);
  });

  it("expects ALLOW only for A cases", () => {
    for (const c of CASES) {
      expect(c.expectedDecision, c.id).toBe(c.id.startsWith("A") ? "ALLOW" : "BLOCK");
    }
  });

  it("uses ledger step names and order object names from ledger.ts", () => {
    for (const c of CASES) {
      expect(STEPS, c.id).toContain(c.ledgerStep);
      if (c.category === "NORMAL") {
        for (const obj of [...c.samDetectedObjects, ...c.sparkClaimedObjects]) {
          expect(OBJECT_NAMES.has(obj), `${c.id}: ${obj}`).toBe(true);
        }
      }
    }
  });
});

describe.each(CASES)("$id $name", (c) => {
  it(`${c.expectedDecision}s with reason containing "${c.expectedReasonKeyword}"`, () => {
    const result = reconcile({
      ledgerState: stateAtStep(c.ledgerStep),
      samDetectedObjects: c.samDetectedObjects,
      sparkClaimedObjects: c.sparkClaimedObjects,
      voiceTranscript: c.voiceTranscript,
      imageText: c.imageText,
    });
    expect(result.decision).toBe(c.expectedDecision);
    expect(result.reason).toContain(c.expectedReasonKeyword);
    if (c.expectedDecision === "ALLOW") {
      expect(result.nextState).toBeDefined();
    } else {
      expect(result.nextState).toBeUndefined();
    }
  });
});
