// Deterministic reconciliation of Spark claim, SAM objects, voice transcript
// and ledger. Pure TypeScript, never an LLM prompt.
// TODO: implement.

export type GuardVerdict = "ALLOW" | "BLOCK";

export interface GuardDecision {
  verdict: GuardVerdict;
  reason: string;
}
