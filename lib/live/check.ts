// Live bridge: one real photo + a typed claim, verified by SAM and decided by
// the EXISTING reconcile() on a fresh ORDER-1042 ledger at VERIFY_MUG.
// No new decision rules: this only maps client results onto ReconcileInput.
//
// Fail closed: a SAM result that did not come from the live API (mock mode or
// mock fallback after an error) verifies nothing, so samDetectedObjects is []
// and reconcile() blocks. The mock voice transcript is likewise never fed in.

import { createLedger, getExpectedObjects, type LedgerStep } from "../guard/ledger";
import { reconcile, type GuardVerdict } from "../guard/reconcile";
import type { MetaSource } from "../meta/http";
import { getSamClient } from "../meta/sam";
import { getVoiceClient } from "../meta/voice";

export interface LiveCheckInput {
  /** Image as a data URI (the format SamInput.frame accepts). */
  frame: string;
  /** The agent's claimed object, typed by the user, e.g. "red mug". */
  claimedObject: string;
  /** Optional WAV as a data URI (the format VoiceInput.audio accepts). */
  audio?: string;
}

export interface LiveCheckResult {
  ledgerStep: LedgerStep;
  expectedObjects: readonly string[];
  claimedObject: string;
  sam: {
    source: MetaSource;
    /** true/false only when SAM ran live; null when the result was a mock. */
    verified: boolean | null;
    error: string | null;
  };
  voice: {
    source: MetaSource;
    /** Real transcript only when Voice ran live; null otherwise. */
    transcript: string | null;
    error: string | null;
  } | null;
  decision: GuardVerdict;
  reason: string;
}

export async function runLiveCheck(input: LiveCheckInput): Promise<LiveCheckResult> {
  const ledgerState = createLedger();
  const claim = input.claimedObject;

  const samOut = await getSamClient().segment({ frame: input.frame, concepts: [claim] });
  const samLive = samOut.source === "live";
  const verified = samLive ? samOut.detections.length > 0 : null;

  let voice: LiveCheckResult["voice"] = null;
  if (input.audio) {
    const voiceOut = await getVoiceClient().transcribe({ audio: input.audio });
    const voiceLive = voiceOut.source === "live";
    voice = {
      source: voiceLive ? "live" : "mock",
      transcript: voiceLive ? voiceOut.transcript : null,
      error: voiceOut.error ?? null,
    };
  }

  const result = reconcile({
    ledgerState,
    sparkClaimedObjects: [claim],
    samDetectedObjects: verified ? [claim] : [],
    voiceTranscript: voice?.transcript ?? "",
    imageText: samOut.imageText,
  });

  return {
    ledgerStep: ledgerState.step,
    expectedObjects: getExpectedObjects(ledgerState.step),
    claimedObject: claim,
    sam: { source: samLive ? "live" : "mock", verified, error: samOut.error ?? null },
    voice,
    decision: result.decision,
    reason: result.reason,
  };
}
