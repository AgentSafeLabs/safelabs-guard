"""SafeLabs Guard: a deterministic checkpoint between an agent's perception and its actions.

This package is a Python port of the guard core from the SafeLabs Guard
reference implementation (https://github.com/AgentSafeLabs/safelabs-guard,
TypeScript). It is NOT a client for the hosted demo.

    from safelabs_guard import create_ledger, guard_action

    ledger = create_ledger()
    gate = guard_action(
        ledger_state=ledger,
        spark_claimed_objects=["red mug"],
        sam_detected_objects=["red mug"],
        voice_transcript="confirmed",
        image_text="",
        proposed_action="ADVANCE",
    )
    if gate.decision == "ALLOW":
        ledger = gate.next_state   # run the action, then move the ledger
"""
from .action_gate import AGENT_ACTIONS, ActionGateResult, guard_action, legal_action_for
from .injections import InjectionResult, detect_injection
from .ledger import (
    ORDER_1042,
    STEPS,
    AllowDecision,
    LedgerState,
    Order,
    OrderItem,
    advance,
    create_ledger,
    create_ledger_at_step,
    get_expected_objects,
    is_ledger_state,
)
from .reconcile import ReconcileResult, reconcile

__version__ = "0.1.0"

__all__ = [
    "AGENT_ACTIONS", "ActionGateResult", "AllowDecision", "InjectionResult", "LedgerState",
    "ORDER_1042", "Order", "OrderItem", "ReconcileResult", "STEPS", "advance", "create_ledger",
    "create_ledger_at_step", "detect_injection", "get_expected_objects", "guard_action",
    "is_ledger_state", "legal_action_for", "reconcile", "__version__",
]
