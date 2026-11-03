# safelabs-guard

**A deterministic checkpoint between an AI agent's perception and its actions.**

`safelabs-guard` is a pure-Python (no dependencies) port of the guard core from
[SafeLabs Guard](https://github.com/AgentSafeLabs/safelabs-guard), a security
checkpoint for AI agents built for the Meta Global AI Developer Hackathon by
Safe Labs AI Inc. It checks the evidence an agent receives and the action it
proposes before an important action is allowed to run. If the evidence does not
match, the action does not run.

- Live demo (TypeScript reference app): https://guard.agentsafelabs.com/live
- Demo video: https://www.youtube.com/watch?v=thHwl6IJM7Y
- Source and full documentation: https://github.com/AgentSafeLabs/safelabs-guard

> **Status: alpha, reference port.** This is not a client for the hosted demo
> (the demo has no public API for third-party agents), and it is not a full
> agent framework. The ledger is fixed to the demo order (`ORDER-1042`: mug,
> notebook, cable, seal, ship). Configurable ledgers are on the roadmap, not in
> this release.

## Install

```bash
pip install safelabs-guard
```

Python 3.11 or newer (tested on 3.11, 3.12 and 3.13). No runtime dependencies.

## Quick start

```python
from safelabs_guard import create_ledger, guard_action

ledger = create_ledger()  # starts at step VERIFY_MUG

gate = guard_action(
    ledger_state=ledger,
    spark_claimed_objects=["red mug"],   # what your model claims is in the frame
    sam_detected_objects=["red mug"],    # what an independent detector found
    voice_transcript="confirmed",        # "" when nothing was said
    image_text="",                       # text read from the frame (OCR)
    proposed_action="ADVANCE",           # ADVANCE | SEAL | SHIP | HOLD
)

if gate.decision == "ALLOW":
    # ...perform the real action here, then move the ledger forward...
    ledger = gate.next_state
else:
    print(gate.decision, gate.reason)    # HOLD or BLOCK: nothing runs
```

A wrong object is blocked, and the ledger does not move:

```python
gate = guard_action(
    ledger_state=create_ledger(),
    spark_claimed_objects=["red mug"],
    sam_detected_objects=["red mug", "banana"],
    voice_transcript="", image_text="",
    proposed_action="ADVANCE",
)
print(gate.decision, "-", gate.reason)
# BLOCK - Perception mismatch: unexpected banana
```

## Decisions

| Decision | Meaning |
| :-- | :-- |
| `ALLOW` | Verified. Run the action and move the ledger to `gate.next_state`. |
| `HOLD` | The agent chose to hold. Nothing runs. |
| `BLOCK` | The guard refused: the action is not the legal one for the step, the evidence does not match the ledger, an injection was detected, or the input was unusable. Nothing runs. |

## What it checks, in order

1. The ledger state is one this library issued, and the order is not complete.
2. Input types are valid (otherwise BLOCK; the guard never raises).
3. Instruction injection in the image text, in the voice transcript, and in both joined (a command split across a sign and a voice).
4. The detector's objects equal the objects expected at this step (missing or unexpected objects BLOCK).
5. The model's claim equals what the detector found.
6. The voice transcript is empty or only a short, allow-listed confirmation.

Only `ALLOW` advances the ledger. Model output, image text and transcripts have
no write access to it, and each ALLOW can be redeemed once.

## How faithful is the port?

This port reproduces `lib/guard/` from the TypeScript reference implementation
(`reconcile`, `ledger`, `action-gate`, `injections`). It was checked against the
original in two ways:

- all 30 hand-written ASI-MM cases from the repository (5 ALLOW, 25 BLOCK) give the expected decision and reason;
- 8,000 randomized inputs (including paraphrased, leetspeak, Unicode look-alike and zero-width injections, and voice-allowlist edge cases) were run through both the TypeScript original and this port with **no differences** in decision, reason or next state.

## Limitations

- **Fixed ledger.** Only the PackProof order (`ORDER-1042`) is built in. Other workflows need a code change.
- **The guard trusts its inputs.** It compares the detector's objects with the ledger. If your detector wrongly reports every required item, the step passes. There is no freshness check, so a replayed frame that shows the right items looks the same as a fresh one.
- **English only.** Injection patterns and the voice allowlist are English. Benign phrases outside the allowlist (for example "ready to ship") are blocked.
- **Not a security audit.** The reference benchmark is a small offline replay of recorded responses; see the repository for results and caveats. This library is not a guarantee against all attacks.
- **Python cannot hide internals as strictly as TypeScript.** The ledger protections hold against untrusted data (JSON, model output), not against code in the same process that deliberately reaches into module internals.
- **Not an SDK for the hosted demo.** The demo's HTTP routes accept only the allow-listed browser origin.

## Development

```bash
pip install -e . pytest
pytest
```

## License

Apache License 2.0. Copyright 2026 Safe Labs AI Inc.
