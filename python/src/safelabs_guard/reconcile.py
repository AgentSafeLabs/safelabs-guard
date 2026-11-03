"""Deterministic reconciliation of the ledger, the model's claim, the detector's
objects and the voice transcript. Plain Python, never an LLM prompt.

Port of ``lib/guard/reconcile.ts``. Only an ALLOW decision produces a
``next_state``; BLOCK leaves the ledger as is. Never raises: wrong-typed input
or an internal error is a BLOCK.

Check order: input shape, ledger, injection (image, voice, then both joined),
perception, reasoning, voice confirmation allowlist.
"""
from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .injections import detect_injection, normalize_text
from .ledger import (
    AllowDecision,
    LedgerState,
    advance,
    get_expected_objects,
    is_ledger_state,
    mint_allow,
)

MAX_OBJECTS = 100
MAX_CONFIRMATION_WORDS = 12

_CONFIRMATIONS: Tuple[Tuple[str, ...], ...] = (
    ("confirmed",), ("confirm",), ("yes",), ("yep",), ("yeah",), ("correct",),
    ("thats", "right"), ("thats", "correct"), ("ok",), ("okay",), ("verified",),
    ("looks", "good"), ("all", "good"),
)
_FILLERS = frozenset({"the", "a", "that", "thats", "this", "is", "its", "it", "and"})


@dataclass(frozen=True)
class ReconcileResult:
    decision: str  # "ALLOW" | "BLOCK"
    reason: str
    next_state: Optional[LedgerState] = None
    allow: Optional[AllowDecision] = None  # ALLOW only; already consumed


def _voice_tokens(transcript: str) -> List[str]:
    t = unicodedata.normalize("NFKC", transcript).lower()
    t = re.sub(r"['’`]", "", t)
    t = re.sub(r"[^a-z0-9\s-]+", " ", t)
    return [w for w in re.split(r"\s+", t) if w]


def _starts_with(tokens: Sequence[str], at: int, phrase: Sequence[str]) -> bool:
    return all(at + i < len(tokens) and tokens[at + i] == w for i, w in enumerate(phrase))


def _is_confirmation_only(transcript: str, step: str) -> bool:
    """Empty, or made only of short confirmations (optionally naming the step's items)."""
    tokens = _voice_tokens(transcript)
    if not tokens:
        return True
    if len(tokens) > MAX_CONFIRMATION_WORDS:
        return False
    items = [label.split(" ") for label in get_expected_objects(step)]
    confirmed = False
    i = 0
    while i < len(tokens):
        conf = next((p for p in _CONFIRMATIONS if _starts_with(tokens, i, p)), None)
        if conf is not None:
            confirmed = True
            i += len(conf)
            continue
        item = next((p for p in items if _starts_with(tokens, i, p)), None)
        if item is not None:
            i += len(item)
            continue
        if tokens[i] in _FILLERS:
            i += 1
            continue
        return False
    return confirmed


def _count_labels(labels: Sequence[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for label in labels:
        key = normalize_text(label)
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
    return counts


def _difference(a: Sequence[str], b: Sequence[str]) -> List[str]:
    """Items in ``a`` not covered by ``b``, respecting multiplicity."""
    remaining = _count_labels(b)
    out: List[str] = []
    for label, n in _count_labels(a).items():
        missing = n - remaining.get(label, 0)
        out.extend([label] * max(0, missing))
    return out


def _same_objects(a: Sequence[str], b: Sequence[str]) -> bool:
    return not _difference(a, b) and not _difference(b, a)


def _block(reason: str) -> ReconcileResult:
    return ReconcileResult("BLOCK", reason)


def _is_label_list(value: object) -> bool:
    return isinstance(value, (list, tuple)) and len(value) <= MAX_OBJECTS and all(isinstance(v, str) for v in value)


def _invalid_field(spark, sam, voice, image_text, confidence) -> Optional[str]:
    if not _is_label_list(spark):
        return "Invalid input: sparkClaimedObjects must be a list of strings"
    if not _is_label_list(sam):
        return "Invalid input: samDetectedObjects must be a list of strings"
    if not isinstance(voice, str):
        return "Invalid input: voiceTranscript must be a string"
    if not isinstance(image_text, str):
        return "Invalid input: imageText must be a string"
    if confidence is not None:
        ok = (
            isinstance(confidence, (int, float))
            and not isinstance(confidence, bool)
            and math.isfinite(confidence)
            and 0 <= confidence <= 1
        )
        if not ok:
            return "Invalid input: samConfidence must be a number from 0 to 1"
    return None


def _check(ledger_state, spark, sam, voice, image_text, confidence) -> ReconcileResult:
    if not is_ledger_state(ledger_state):
        return _block("Invalid ledger state")
    if ledger_state.status == "COMPLETE":
        return _block("Order already complete")

    invalid = _invalid_field(spark, sam, voice, image_text, confidence)
    if invalid:
        return _block(invalid)

    image_inj = detect_injection(image_text)
    if image_inj.detected:
        return _block(f'Injection attempt detected: image text ("{image_inj.matched}")')
    voice_inj = detect_injection(voice)
    if voice_inj.detected:
        return _block(f'Injection attempt detected: voice transcript ("{voice_inj.matched}")')
    # A command split across the sign and the voice ("please ship" + "it").
    split_inj = detect_injection(f"{image_text} {voice}")
    if split_inj.detected:
        return _block(f'Injection attempt detected: image text + voice transcript ("{split_inj.matched}")')

    expected = get_expected_objects(ledger_state.step)
    missing = _difference(expected, sam)
    if missing:
        return _block(f"Perception mismatch: missing {', '.join(missing)}")
    unexpected = _difference(sam, expected)
    if unexpected:
        return _block(f"Perception mismatch: unexpected {', '.join(unexpected)}")

    if not _same_objects(spark, sam):
        return _block("Reasoning does not match frame")

    if not _is_confirmation_only(voice, ledger_state.step):
        return _block("Voice contains an instruction, not a confirmation")

    allow = mint_allow(ledger_state)
    return ReconcileResult("ALLOW", f"Verified {ledger_state.step}", advance(allow), allow)


def reconcile(
    *,
    ledger_state: LedgerState,
    spark_claimed_objects: Sequence[str],
    sam_detected_objects: Sequence[str],
    voice_transcript: str,
    image_text: str,
    sam_confidence: Optional[float] = None,
) -> ReconcileResult:
    """Check the evidence against the ledger. Never raises; any error is a BLOCK."""
    try:
        return _check(ledger_state, spark_claimed_objects, sam_detected_objects, voice_transcript, image_text, sam_confidence)
    except Exception:  # noqa: BLE001 - never ALLOW on an exception
        return _block("Guard error: input could not be checked")
