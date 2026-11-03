"""Deterministic ledger state machine for the PackProof demo order.

Port of ``lib/guard/ledger.ts``. Model output, image text and voice
transcripts have NO write access to the ledger:

* states are immutable and only states this module issued are accepted, so a
  state forged from model/JSON output is rejected;
* :func:`advance` takes an :class:`AllowDecision` minted only inside
  ``reconcile()`` on ALLOW, and each decision is consumed the first time it is
  redeemed, so ``advance()`` cannot be called directly or replayed;
* no function here accepts free text.

Note: Python cannot enforce this as strictly as the TypeScript original. The
guarantees hold against accidental misuse and against untrusted *data*
(JSON, model output), not against code in the same process that is willing to
reach into module internals.
"""
from __future__ import annotations

import weakref
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

STEPS: Tuple[str, ...] = ("VERIFY_MUG", "VERIFY_NOTEBOOK", "VERIFY_CABLE", "SEAL", "SHIP")


@dataclass(frozen=True)
class OrderItem:
    label: str
    qty: int


@dataclass(frozen=True)
class Order:
    id: str
    items: Tuple[OrderItem, ...]


ORDER_1042 = Order(
    id="ORDER-1042",
    items=(OrderItem("red mug", 1), OrderItem("blue notebook", 1), OrderItem("usb-c cable", 1)),
)

# Objects that must be in frame at each step. Items accumulate in the box.
_EXPECTED: Dict[str, Tuple[str, ...]] = {
    "VERIFY_MUG": ("red mug",),
    "VERIFY_NOTEBOOK": ("red mug", "blue notebook"),
    "VERIFY_CABLE": ("red mug", "blue notebook", "usb-c cable"),
    "SEAL": ("red mug", "blue notebook", "usb-c cable"),
    "SHIP": ("red mug", "blue notebook", "usb-c cable"),
}


@dataclass(frozen=True, eq=False)
class LedgerState:
    """An issued ledger state. Compare states by identity; use :meth:`to_dict` to log."""

    order_id: str
    step_index: int
    step: str
    status: str  # "IN_PROGRESS" | "COMPLETE"

    def to_dict(self) -> Dict[str, object]:
        return {"orderId": self.order_id, "stepIndex": self.step_index, "step": self.step, "status": self.status}


_issued: "weakref.WeakSet[LedgerState]" = weakref.WeakSet()


def _issue(order_id: str, step_index: int, status: str) -> LedgerState:
    state = LedgerState(order_id, step_index, STEPS[step_index], status)
    _issued.add(state)
    return state


def is_ledger_state(state: object) -> bool:
    """True only for a state this module issued."""
    try:
        return isinstance(state, LedgerState) and state in _issued
    except TypeError:
        return False


def create_ledger(order: Order = ORDER_1042) -> LedgerState:
    """A fresh ledger at the first step."""
    return _issue(order.id, 0, "IN_PROGRESS")


def get_expected_objects(step: str) -> Tuple[str, ...]:
    return _EXPECTED[step]


def create_ledger_at_step(step: str, *, order: Order = ORDER_1042, complete: bool = False) -> LedgerState:
    """A fresh, issued state at ``step``. Raises on an unknown step; never parses free text."""
    if step not in STEPS:
        raise ValueError("Unknown ledger step")
    if complete and step != "SHIP":
        raise ValueError("Only SHIP can be complete")
    return _issue(order.id, STEPS.index(step), "COMPLETE" if complete else "IN_PROGRESS")


class AllowDecision:
    """Proof that ``reconcile()`` ALLOWed a state. Single use. Do not construct directly."""

    __slots__ = ("kind", "step", "__weakref__")

    def __init__(self, step: str) -> None:
        self.kind = "ALLOW"
        self.step = step


_minted: "weakref.WeakKeyDictionary[AllowDecision, LedgerState]" = weakref.WeakKeyDictionary()


def mint_allow(state: LedgerState) -> AllowDecision:
    decision = AllowDecision(state.step)
    _minted[decision] = state
    return decision


def redeem_allow(decision: object) -> Optional[LedgerState]:
    """For :func:`advance` only: the ALLOWed state, or None. Consumes the decision."""
    if not isinstance(decision, AllowDecision):
        return None
    state = _minted.pop(decision, None)
    return state


def advance(decision: AllowDecision) -> LedgerState:
    """The state after the one ``reconcile()`` ALLOWed. Accepts only an unused decision."""
    state = redeem_allow(decision)
    if state is None:
        raise ValueError("advance() needs an unused ALLOW decision from reconcile()")
    if not is_ledger_state(state):
        raise ValueError("Ledger rejected a state it did not issue")
    if state.status == "COMPLETE":
        raise ValueError("Ledger is already complete")
    next_index = state.step_index + 1
    if next_index >= len(STEPS):
        return _issue(state.order_id, state.step_index, "COMPLETE")
    return _issue(state.order_id, next_index, "IN_PROGRESS")
