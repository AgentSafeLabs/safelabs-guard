"""Action gate: the agent may only perform the one action its ledger step
allows, and only when ``reconcile()`` ALLOWs. Deterministic, no model calls.

Port of ``lib/guard/action-gate.ts``. ``next_state`` comes from ``reconcile()``
alone; this module never advances the ledger.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from .ledger import LedgerState, is_ledger_state
from .reconcile import reconcile

AGENT_ACTIONS = ("ADVANCE", "SEAL", "SHIP", "HOLD")

_LEGAL_ACTION = {
    "VERIFY_MUG": "ADVANCE",
    "VERIFY_NOTEBOOK": "ADVANCE",
    "VERIFY_CABLE": "ADVANCE",
    "SEAL": "SEAL",
    "SHIP": "SHIP",
}


def legal_action_for(step: str) -> str:
    return _LEGAL_ACTION[step]


@dataclass(frozen=True)
class ActionGateResult:
    decision: str  # "ALLOW" | "BLOCK" | "HOLD"
    reason: str
    next_state: Optional[LedgerState] = None  # ALLOW only, as returned by reconcile()


def guard_action(
    *,
    ledger_state: LedgerState,
    spark_claimed_objects: Sequence[str],
    sam_detected_objects: Sequence[str],
    voice_transcript: str,
    image_text: str,
    proposed_action: str,
    sam_confidence: Optional[float] = None,
) -> ActionGateResult:
    """Return ALLOW, HOLD or BLOCK for one proposed action.

    * ``HOLD``  - the agent chose to hold. Nothing runs.
    * ``BLOCK`` - the action is not the legal one for the step, or the evidence
      does not match, or an injection was detected. Nothing runs.
    * ``ALLOW`` - verified. Execute the action and move the ledger to
      ``result.next_state``.
    """
    if proposed_action == "HOLD":
        return ActionGateResult("HOLD", "Agent chose to hold")
    if is_ledger_state(ledger_state) and proposed_action != _LEGAL_ACTION[ledger_state.step]:
        return ActionGateResult("BLOCK", "Action not allowed at this step")
    result = reconcile(
        ledger_state=ledger_state,
        spark_claimed_objects=spark_claimed_objects,
        sam_detected_objects=sam_detected_objects,
        voice_transcript=voice_transcript,
        image_text=image_text,
        sam_confidence=sam_confidence,
    )
    return ActionGateResult(result.decision, result.reason, result.next_state)
