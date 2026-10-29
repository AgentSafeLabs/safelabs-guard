import { describe, expect, it } from "vitest";
import { STEPS } from "../guard/ledger";
import { deriveProgress, STEP_NAMES, STEP_SHORT } from "./progress";

describe("step names", () => {
  it("has a human name and a short label for every ledger step", () => {
    expect(STEPS.map((s) => STEP_NAMES[s])).toEqual([
      "Verify the mug",
      "Verify the notebook",
      "Verify the cable",
      "Seal the box",
      "Ship the order",
    ]);
    expect(STEP_SHORT).toEqual(["Mug", "Notebook", "Cable", "Seal", "Ship"]);
  });
});

describe("deriveProgress", () => {
  const states = (p: ReturnType<typeof deriveProgress>) => p.segments.map((s) => s.state);

  it("starts at step 1 before any turn", () => {
    const p = deriveProgress(null, null);
    expect(p).toMatchObject({ stepNumber: 1, total: 5, name: "Verify the mug", next: "Verify the notebook", complete: false });
    expect(states(p)).toEqual(["current", "pending", "pending", "pending", "pending"]);
  });

  it("marks earlier steps done and later ones pending", () => {
    const p = deriveProgress({ stepIndex: 2, status: "IN_PROGRESS" }, "ALLOW");
    expect(p).toMatchObject({ stepNumber: 3, name: "Verify the cable", next: "Seal the box" });
    expect(states(p)).toEqual(["done", "done", "current", "pending", "pending"]);
  });

  it("marks the current step held after a HOLD or BLOCK", () => {
    for (const d of ["HOLD", "BLOCK"]) {
      expect(states(deriveProgress({ stepIndex: 1, status: "IN_PROGRESS" }, d))).toEqual(["done", "held", "pending", "pending", "pending"]);
    }
  });

  it("does not hold an unguarded run (no decision)", () => {
    expect(states(deriveProgress({ stepIndex: 1, status: "IN_PROGRESS" }, null))[1]).toBe("current");
  });

  it("omits Next on the last step", () => {
    const p = deriveProgress({ stepIndex: 4, status: "IN_PROGRESS" }, null);
    expect(p).toMatchObject({ stepNumber: 5, name: "Ship the order", next: null });
  });

  it("shows every segment done when the ledger is complete, even after a later BLOCK", () => {
    const p = deriveProgress({ stepIndex: 5, status: "COMPLETE" }, "BLOCK");
    expect(p).toMatchObject({ stepNumber: 5, complete: true, next: null });
    expect(states(p)).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("stays in range for a malformed index", () => {
    expect(deriveProgress({ stepIndex: -3, status: "IN_PROGRESS" }, null).stepNumber).toBe(1);
    expect(deriveProgress({ stepIndex: 99, status: "IN_PROGRESS" }, null).stepNumber).toBe(5);
    expect(deriveProgress({ stepIndex: Number.NaN, status: "IN_PROGRESS" }, null).stepNumber).toBe(1);
  });
});
