// Deterministic ledger state machine for PackProof.
//
// Model output, image text and voice transcript have NO write access:
// - every state is deep-frozen, so it cannot be mutated in place;
// - only states this module issued are accepted (isLedgerState), so a state
//   forged from model/JSON output (e.g. { stepIndex: 4 }) is rejected;
// - advance() takes an AllowDecision, not a state. Decisions are minted only
//   inside reconcile() on ALLOW (a private WeakMap there; see redeemAllow),
//   and each one is consumed the first time it is redeemed, so advance()
//   cannot be called directly and a decision cannot be replayed;
// - no function here accepts free text. createLedgerAtStep() is the single
//   named helper that builds a state at a given step (session tokens that were
//   already signature-checked, demos, tests, the benchmark, and the
//   deliberately unchecked unguarded baseline).
//
// ledger.ts and reconcile.ts import each other. Neither touches the other's
// bindings at module load, only inside functions, so either can load first.

import { redeemAllow } from "./reconcile";

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

declare const ALLOW_BRAND: unique symbol;

/**
 * Proof that reconcile() ALLOWed `from`. The brand is type-level only; the
 * runtime check is reconcile.ts's private registry. Single use.
 */
export interface AllowDecision {
  readonly [ALLOW_BRAND]: true;
  readonly kind: "ALLOW";
  readonly step: LedgerStep;
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

export interface LedgerAtStepOptions {
  order?: Order;
  /** Only with step "SHIP": the state after SHIP was ALLOWed. */
  complete?: boolean;
}

/**
 * A fresh, issued state at `step`. The ONLY way to start anywhere but the
 * first step. Throws on an unknown step: it never parses free text.
 */
export function createLedgerAtStep(step: LedgerStep, options: LedgerAtStepOptions = {}): LedgerState {
  const stepIndex = (STEPS as readonly string[]).indexOf(step);
  if (stepIndex < 0) throw new Error("Unknown ledger step");
  if (options.complete && step !== "SHIP") throw new Error("Only SHIP can be complete");
  return issue({
    orderId: (options.order ?? ORDER_1042).id,
    stepIndex,
    step: STEPS[stepIndex],
    status: options.complete ? "COMPLETE" : "IN_PROGRESS",
  });
}

/**
 * Returns the state after the one reconcile() ALLOWed. Accepts only an unused
 * AllowDecision; anything else (a state, a forged or replayed decision) throws.
 * Never mutates its input.
 */
export function advance(decision: AllowDecision): LedgerState {
  const state = redeemAllow(decision);
  if (!state) throw new Error("advance() needs an unused ALLOW decision from reconcile()");
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
