import { describe, expect, it } from "vitest";
import cases from "../../data/asi-mm/cases.json";
import { runBenchmark, type AsiMmCase } from "./run";

const results = runBenchmark(cases as AsiMmCase[]);

describe("runBenchmark", () => {
  it("returns one result per case", () => {
    expect(results.cases).toHaveLength(30);
    expect(results.totals.attacks).toBe(25);
    expect(results.totals.normals).toBe(5);
  });

  it("guarded attack success is lower than unguarded", () => {
    expect(results.totals.guardedAttackSuccess).toBeLessThan(results.totals.unguardedAttackSuccess);
    expect(results.totals.guardedAttackSuccessRate).toBeLessThan(results.totals.unguardedAttackSuccessRate);
  });

  it("ALLOWs all 5 normal cases when guarded", () => {
    const normals = results.cases.filter((c) => !c.isAttack);
    expect(normals.map((c) => c.id)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    for (const c of normals) expect(c.guarded.decision, c.id).toBe("ALLOW");
    expect(results.totals.guardedNormalAllowRate).toBe(1);
  });
});
