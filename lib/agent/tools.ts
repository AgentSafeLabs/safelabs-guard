// The agent's tools. Two ways to run them:
// - executeGuarded: only after guardAction() ALLOWed this action; the ledger
//   moves to the nextState reconcile() returned, nothing else.
// - executeUnguarded: the baseline agent. It does what the model proposed with
//   no checks (SHIP ships even at step 1). It moves its own ledger to the next
//   step with createLedgerAtStep(), skipping reconcile(): exactly the bypass
//   the guard exists to stop. (advance() itself only takes ALLOW decisions.)

import type { ActionGateResult } from "../guard/action-gate";
import { createLedgerAtStep, STEPS, type LedgerState } from "../guard/ledger";
import type { AgentAction, PackSession } from "./types";

export function advanceStep(session: PackSession, nextLedger: LedgerState): void {
  session.ledger = nextLedger;
}

export function sealBox(session: PackSession, nextLedger: LedgerState): void {
  session.sealed = true;
  session.ledger = nextLedger;
}

export function shipOrder(session: PackSession, nextLedger: LedgerState): void {
  session.shipped = true;
  session.ledger = nextLedger;
}

function runTool(session: PackSession, action: AgentAction, nextLedger: LedgerState): AgentAction | null {
  switch (action) {
    case "ADVANCE":
      advanceStep(session, nextLedger);
      return action;
    case "SEAL":
      sealBox(session, nextLedger);
      return action;
    case "SHIP":
      shipOrder(session, nextLedger);
      return action;
    default:
      return null;
  }
}

/** Runs the tool only on ALLOW with a reconcile-issued nextState. Returns what ran. */
export function executeGuarded(session: PackSession, action: AgentAction, gate: ActionGateResult): AgentAction | null {
  if (gate.decision !== "ALLOW" || !gate.nextState) return null;
  return runTool(session, action, gate.nextState);
}

/** The step after `ledger`, with no checks. Unguarded baseline only. */
function uncheckedNext(ledger: LedgerState): LedgerState {
  if (ledger.status === "COMPLETE") return ledger;
  const next = STEPS[ledger.stepIndex + 1];
  return next ? createLedgerAtStep(next) : createLedgerAtStep("SHIP", { complete: true });
}

/** Baseline: applies the proposed action directly. Returns what ran. */
export function executeUnguarded(session: PackSession, action: AgentAction): AgentAction | null {
  if (action === "HOLD") return null;
  // A complete ledger cannot advance further; the side effect still happens.
  return runTool(session, action, uncheckedNext(session.ledger));
}
