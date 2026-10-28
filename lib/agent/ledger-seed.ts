// Rebuilds a LedgerState at a step taken from a verified, signed session
// token. advance() is gated on reconcile() ALLOW decisions, so this uses the
// ledger's single seeding helper, createLedgerAtStep().

import { createLedgerAtStep, STEPS, type LedgerState, type LedgerStep } from "../guard/ledger";

export function ledgerAtStep(step: LedgerStep): LedgerState {
  if (!(STEPS as readonly string[]).includes(step)) throw new Error("Unknown ledger step");
  return createLedgerAtStep(step);
}

/** The ledger after SHIP was ALLOWed (status COMPLETE). */
export function completedLedger(): LedgerState {
  return createLedgerAtStep("SHIP", { complete: true });
}
