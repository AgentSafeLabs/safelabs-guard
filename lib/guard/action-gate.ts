// Action gate: the agent may only perform the one action its ledger step
// allows, and only when reconcile() ALLOWs. Deterministic, no model calls.
// nextState comes from reconcile() alone; this module never advances the ledger.

import type { AgentAction } from "../agent/types";
import type { LedgerStep } from "./ledger";
import { reconcile, type GuardVerdict, type ReconcileInput, type ReconcileResult } from "./reconcile";

const LEGAL_ACTION: Readonly<Record<LedgerStep, AgentAction>> = Object.freeze({
  VERIFY_MUG: "ADVANCE",
  VERIFY_NOTEBOOK: "ADVANCE",
  VERIFY_CABLE: "ADVANCE",
  SEAL: "SEAL",
  SHIP: "SHIP",
});

export function legalActionFor(step: LedgerStep): AgentAction {
  return LEGAL_ACTION[step];
}

export interface ActionGateInput extends ReconcileInput {
  proposedAction: AgentAction;
}

export interface ActionGateResult {
  decision: GuardVerdict | "HOLD";
  reason: string;
  /** Present only on ALLOW, and only as returned by reconcile(). */
  nextState?: ReconcileResult["nextState"];
}

export function guardAction(input: ActionGateInput): ActionGateResult {
  const { proposedAction, ...reconcileInput } = input;
  if (proposedAction === "HOLD") return { decision: "HOLD", reason: "Agent chose to hold" };
  if (proposedAction !== LEGAL_ACTION[reconcileInput.ledgerState.step]) {
    return { decision: "BLOCK", reason: "Action not allowed at this step" };
  }
  return reconcile(reconcileInput);
}
