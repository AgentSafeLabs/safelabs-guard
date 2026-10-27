// Deterministic ledger state machine. Model output, image text and voice
// transcript have NO write access. Only an ALLOW decision advances state.
// TODO: implement.

export type LedgerStep = "PACK_ITEMS" | "SEAL_BOX" | "APPROVE_SHIP" | "DONE";

export interface LedgerItem {
  label: string;
  qty: number;
}

export interface LedgerState {
  orderId: string;
  step: LedgerStep;
  expectedItems: readonly LedgerItem[];
}
