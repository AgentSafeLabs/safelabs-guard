// Deterministic ledger state machine for PackProof.
//
// Model output, image text and voice transcript have NO write access:
// - every state is deep-frozen, so it cannot be mutated in place;
// - advance() only accepts states this module issued, so a state forged
//   from model/JSON output (e.g. { stepIndex: 4 }) is rejected;
// - no function here accepts free text. Only reconcile() calls advance(),
//   and only on ALLOW.

export const STEPS = [
  "VERIFY_MUG",
  "VERIFY_NOTEBOOK",
  "VERIFY_CABLE",
  "SEAL",
  "SHIP",
] as const;

export type LedgerStep = (typeof STEPS)[number];

export interface OrderItem {
  readonly label: string;
  readonly qty: number;
}

export interface Order {
  readonly id: string;
  readonly items: readonly OrderItem[];
}

export const ORDER_1042: Order = Object.freeze({
  id: "ORDER-1042",
  items: Object.freeze([
    Object.freeze({ label: "red mug", qty: 1 }),
    Object.freeze({ label: "blue notebook", qty: 1 }),
    Object.freeze({ label: "usb-c cable", qty: 1 }),
  ]),
});

export type LedgerStatus = "IN_PROGRESS" | "COMPLETE";

export interface LedgerState {
  readonly orderId: string;
  readonly stepIndex: number;
  readonly step: LedgerStep;
  readonly status: LedgerStatus;
}

// Objects that must be in frame at each step. Items accumulate in the box,
// so each VERIFY step expects everything verified so far plus its own item.
const EXPECTED: Readonly<Record<LedgerStep, readonly string[]>> =
  Object.freeze({
    VERIFY_MUG: Object.freeze(["red mug"]),
    VERIFY_NOTEBOOK: Object.freeze(["red mug", "blue notebook"]),
    VERIFY_CABLE: Object.freeze(["red mug", "blue notebook", "usb-c cable"]),
    SEAL: Object.freeze(["red mug", "blue notebook", "usb-c cable"]),
    SHIP: Object.freeze(["red mug", "blue notebook", "usb-c cable"]),
  });

const issued = new WeakSet<LedgerState>();

function issue(state: LedgerState): LedgerState {
  const frozen = Object.freeze({ ...state });
  issued.add(frozen);
  return frozen;
}

export function isLedgerState(state: unknown): state is LedgerState {
  return typeof state === "object" && state !== null && issued.has(state as LedgerState);
}

function assertIssued(state: LedgerState): void {
  if (!isLedgerState(state)) {
    throw new Error("Ledger rejected a state it did not issue");
  }
}

export function createLedger(order: Order = ORDER_1042): LedgerState {
  return issue({
    orderId: order.id,
    stepIndex: 0,
    step: STEPS[0],
    status: "IN_PROGRESS",
  });
}

export function getExpectedObjects(step: LedgerStep): readonly string[] {
  return EXPECTED[step];
}

/** Returns the next state. Never mutates the input. */
export function advance(state: LedgerState): LedgerState {
  assertIssued(state);
  if (state.status === "COMPLETE") {
    throw new Error("Ledger is already complete");
  }
  const nextIndex = state.stepIndex + 1;
  if (nextIndex >= STEPS.length) {
    return issue({ ...state, status: "COMPLETE" });
  }
  return issue({ ...state, stepIndex: nextIndex, step: STEPS[nextIndex] });
}
