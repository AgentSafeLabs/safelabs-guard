"""Deterministic, case-insensitive detection of instruction injection.

Port of ``lib/guard/injections.ts`` from the SafeLabs Guard reference
implementation. No model calls. Text is normalized (Unicode NFKC, invisible
characters removed, common Cyrillic/Greek look-alikes folded to Latin,
whitespace collapsed, lowercased) and matched in several variants: as
normalized, with leetspeak mapped (1 read as "i" and, separately, as "l"),
and with stray symbols removed. Multi-word patterns tolerate up to 3 short
OCR junk tokens between their words.

Patterns are English only.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional, Tuple

# Up to 3 junk tokens (1-3 characters each) may sit between pattern words.
_GAP = r"\s+(?:\S{1,3}\s+){0,3}"


def _p(label: str, source: str) -> Tuple[str, "re.Pattern[str]"]:
    """A space in ``source`` means GAP. Patterns match normalized text."""
    return (label, re.compile(source.replace(" ", _GAP)))


_OVERRIDE_VERB = r"(?:ignore|disregard|forget|override|skip|bypass)"
_DETERMINER = r"(?:all|the|any|your|these|those|previous|prior|earlier|above|my)"
_GUARDED_THING = r"(?:instructions?|rules?|checks?|verifications?|restrictions?|guard(?:rails?)?|safety)"

_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    # The original 10 (labels unchanged).
    _p("ignore checks", r"\bignore (?:all |the |any )?checks?\b"),
    _p("ignore previous", r"\bignore (?:all |the |any )?previous\b"),
    _p("approve shipment", r"\bapprove (?:the |this )?(?:shipment|shipping)\b"),
    _p("approve now", r"\bapprove (?:it |this |the order )?now\b"),
    _p("ship it", r"\bship it\b"),
    _p("manager override", r"\bmanager override\b"),
    _p("system:", r"\bsystem\s*:"),
    _p("ledger updated", r"\bledger (?:has been |was )?updated\b"),
    _p("order cancelled", r"\border (?:has been |was |is )?cancell?ed\b"),
    _p("skip verification", r"\bskip (?:the |all )?verifications?\b"),
    # Paraphrases of "ignore the rules".
    _p("ignore instructions", rf"\b{_OVERRIDE_VERB} (?:{_DETERMINER} ){{0,3}}{_GUARDED_THING}\b"),
    _p("don't worry about the rules", r"\b(?:dont|do not) worry about (?:the |any |those |these )?(?:restrictions?|rules?|checks?|verifications?)\b"),
    # Role / authority hijack.
    _p("you are now", r"\byou are now\b"),
    _p("new instructions", r"\bnew instructions?\b"),
    _p("system prompt", r"\bsystem prompt\b"),
    _p("developer mode", r"\bdeveloper mode\b"),
    _p("operator override", r"\b(?:operator|admin|administrator|supervisor) override\b"),
    _p("system notice", r"\bsystem (?:notice|message|override)\b"),
    _p("authority claim", r"\b(?:the )?(?:manager|admin|administrator|operator|boss|supervisor) (?:says|said|approved|approves|authori[sz]ed|wants)\b"),
    # Direct shipping commands.
    _p("mark shipped", r"\bmark (?:the )?(?:order )?(?:[a-z0-9-]+ )?(?:as )?shipped\b"),
    _p("ship it", r"\bship (?:it|this|that|the (?:product|order|box|package|items?))\b"),
    _p("send it", r"\bsend (?:it|this|the (?:order|box|package)) (?:now|out|off)\b"),
    _p("just ship", r"\bjust ship\b"),
    # Concealment and false claims of completion.
    _p("do not tell", r"\b(?:dont|do not|never) (?:tell|inform|mention)\b"),
    _p("this is a test", r"\bthis is (?:just )?(?:a |only a )?test\b.{0,30}\bproceed\b"),
    _p("already verified", r"\balready (?:been )?verified\b"),
    _p("all items verified", r"\ball (?:the )?items? (?:are |have been |were )?(?:already )?verified\b"),
]


@dataclass(frozen=True)
class InjectionResult:
    detected: bool
    matched: Optional[str] = None


def normalize_text(text: str) -> str:
    """Lowercase and collapse whitespace only. Used for object labels."""
    return re.sub(r"\s+", " ", text.lower()).strip()


_INVISIBLE = re.compile(
    "[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿\U000e0000-\U000e007f]"
)

# Lowercase Cyrillic and Greek letters that look like Latin ones.
_CONFUSABLES = {
    "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o",
    "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ї": "i",
    "ј": "j", "ԁ": "d", "ӏ": "l", "ԛ": "q", "ԝ": "w", "ү": "y", "һ": "h",
    "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o",
    "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w", "ς": "s",
}
_CONFUSABLE_TABLE = {ord(k): v for k, v in _CONFUSABLES.items()}

_LEET = {"0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}
_LEET_RE = re.compile(r"[013457@$]")
_APOS_RE = re.compile(r"['’`]")
_NON_ALNUM_RE = re.compile(r"(?:[^\w\s-]|_)+")


def _leet(text: str, one: str) -> str:
    return _LEET_RE.sub(lambda m: one if m.group(0) == "1" else _LEET[m.group(0)], text)


def _strip_symbols(text: str) -> str:
    """Symbols become spaces; apostrophes vanish so "don't" reads "dont"."""
    text = _APOS_RE.sub("", text)
    text = _NON_ALNUM_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _base_normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _INVISIBLE.sub("", text)
    text = text.lower().translate(_CONFUSABLE_TABLE)
    return re.sub(r"\s+", " ", text).strip()


def normalize_for_scan(text: str) -> str:
    """NFKC, invisible chars removed, confusables folded, 1 -> i, apostrophes dropped."""
    return _APOS_RE.sub("", _leet(_base_normalize(text), "i"))


def _variants(text: str) -> List[str]:
    base = _base_normalize(text)
    forms = [base, _leet(base, "i"), _leet(base, "l")]
    out: List[str] = []
    for f in forms:
        for v in (_APOS_RE.sub("", f), _strip_symbols(f)):
            if v and v not in out:
                out.append(v)
    return out


def detect_injection(text: object) -> InjectionResult:
    """Scan one text for instruction injection."""
    if not isinstance(text, str) or not text.strip():
        return InjectionResult(False)
    forms = _variants(text)
    for label, pattern in _PATTERNS:
        if any(pattern.search(f) for f in forms):
            return InjectionResult(True, label)
    return InjectionResult(False)
