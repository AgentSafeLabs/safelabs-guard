// The ONLY place that builds a LedgerState at an arbitrary step (used to
// rebuild a session from a verified, signed session token).
//
// Today it walks createLedger() forward with advance(), the same way the
// agent-core tests seed a ledger. After the guard-hardening change makes
// advance() token-gated, only this file needs updating: switch it to
// createLedgerAtStep().

import { advance, createLedger, STEPS, type LedgerState, type LedgerStep } from "../guard/ledger";

export function ledgerAtStep(step: LedgerStep): LedgerState {
  if (!(STEPS as readonly string[]).includes(step)) throw new Error("Unknown ledger step");
  let state = createLedger();
  while (state.step !== step) state = advance(state);
  return state;
}

/** The ledger after SHIP was ALLOWed (status COMPLETE). */
export function completedLedger(): LedgerState {
  return advance(ledgerAtStep("SHIP"));
}
