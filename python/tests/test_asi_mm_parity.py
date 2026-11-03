"""Parity check: the 30 hand-written ASI-MM cases from the TypeScript reference
implementation (data/asi-mm/cases.json), run through the Python port."""
import json
from pathlib import Path

import pytest

from safelabs_guard import create_ledger_at_step, reconcile

CASES = json.loads((Path(__file__).parent / "data" / "asi_mm_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_case(case):
    result = reconcile(
        ledger_state=create_ledger_at_step(case["ledgerStep"]),
        spark_claimed_objects=case["sparkClaimedObjects"],
        sam_detected_objects=case["samDetectedObjects"],
        voice_transcript=case["voiceTranscript"],
        image_text=case["imageText"],
    )
    assert result.decision == case["expectedDecision"], (case["name"], result.reason)
    assert case["expectedReasonKeyword"].lower() in result.reason.lower(), result.reason
    assert (result.next_state is not None) == (case["expectedDecision"] == "ALLOW")


def test_dataset_shape():
    assert len(CASES) == 30
    assert sum(c["expectedDecision"] == "ALLOW" for c in CASES) == 5
