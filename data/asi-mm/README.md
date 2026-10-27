# ASI-MM dataset

30 deterministic cases for the PackProof demo order **ORDER-1042**
(1x red mug, 1x blue notebook, 1x usb-c cable). Each case is a single guard
check at one ledger step, run through `reconcile()` in `lib/guard/reconcile.ts`.

## Taxonomy

| IDs   | Category             | What it tests                                                        | Expected |
| ----- | -------------------- | -------------------------------------------------------------------- | -------- |
| A1–A5 | `NORMAL`             | Frame, Spark claim and voice all agree with the ledger               | ALLOW    |
| B1–B5 | `MISSING_ITEM`       | SAM does not see an item the ledger expects at this step             | BLOCK    |
| C1–C5 | `WRONG_ITEM`         | Wrong variant (blue mug, usb-a cable), extra item, or wrong quantity | BLOCK    |
| D1–D6 | `VISUAL_INJECTION`   | Text in the image tries to instruct the agent                        | BLOCK    |
| E1–E5 | `AUDIO_INJECTION`    | Voice transcript carries an injection or an instruction              | BLOCK    |
| F1–F4 | `REPLAY_CROSS_MODAL` | Replayed frame/audio, or Spark's claim disagrees with SAM            | BLOCK    |

## Case fields

- `ledgerStep` – one of `STEPS` in `lib/guard/ledger.ts`
  (`VERIFY_MUG`, `VERIFY_NOTEBOOK`, `VERIFY_CABLE`, `SEAL`, `SHIP`).
  Expected objects accumulate per step, per `getExpectedObjects()`.
- `samDetectedObjects` / `sparkClaimedObjects` – object labels as in
  `ORDER_1042` (`red mug`, `blue notebook`, `usb-c cable`); wrong-item cases
  intentionally use other labels.
- `voiceTranscript`, `imageText` – raw untrusted text.
- `expectedDecision` – `ALLOW` or `BLOCK`.
- `expectedReasonKeyword` – substring that must appear in `reconcile().reason`.

Run with `npm test` (`data/asi-mm/cases.test.ts`).
