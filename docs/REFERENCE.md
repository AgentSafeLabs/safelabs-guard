# Technical reference

Technical design, routes, project structure and the early SAM check. Moved out of the [README](../README.md).

## Technical Design

Guard is **deterministic code, not a safety prompt**. Core logic in `lib/guard/reconcile.ts`:

```
IF sam_objects != ledger_expected -> BLOCK: Perception mismatch
IF spark_claim != sam_objects -> BLOCK: Reasoning does not match frame
IF voice contains instruction OR != expected_confirm -> BLOCK
IF injection detected in image_text OR transcript -> BLOCK: Injection attempt
ELSE -> ALLOW next step only
```

The ledger state machine can only advance on ALLOW. Model outputs, image text, and transcripts have no write access to it.

Session and approval tokens:
* Refreshing the page restarts the run: the session token is held in browser memory only.
* Session tokens can be replayed for up to 30 minutes and approvals for 5 minutes. Approval is single-use per approval token: one shipment is created per approval, and repeating the same approval returns that shipment.

Full design: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)

## Routes

| Route | What it is |
| :--- | :--- |
| `/` | Home: what Safelabs Guard is, how a turn is checked, FAQ |
| `/live` | The PackProof agent with a camera or an uploaded image, and a microphone (guarded and unguarded modes) |
| `/scenarios` | Scripted scenarios on mock perception, labelled as such |
| `/api/agent/turn` | One agent turn (multipart: mode, session token, image, optional audio) |
| `/api/packproof/ship` | Simulated shipment from a signed SHIP approval |
| `/api/guard/live-check` | Live SAM check used by the Live verification box on `/scenarios` |
| `/api/meta/status` | Which Meta clients are live or mock |

## Project Structure

```
safelabs-guard/
  app/                  # Next.js: / home, /live live agent, /scenarios mock-perception scenarios
  components/           # LiveAgent, Ledger, GuardDecision, BenchmarkBar, packproof/ (live UI)
  lib/guard/            # reconcile.ts, ledger.ts, injections.ts
  lib/meta/             # spark.ts, sam.ts, voice.ts (live clients + mock fallback)
  lib/agent/            # PackProof agent loop, OCR/vision, session tokens, approvals
  lib/server/           # request limits, origin check, rate limit, kill switch, route logic
  lib/live/             # Live verification bridge -> existing reconcile()
  lib/benchmark/        # Guarded vs. unguarded mock benchmark logic (ASI-MM)
  lib/bench/            # Media-backed benchmark runner, recorder and report
  bench/                # 40-case media-backed benchmark: manifest, media, recordings, RESULTS.md
  data/asi-mm/          # 30-case attack dataset (mock perception)
  scripts/              # Benchmark runners
  docs/                 # ARCHITECTURE.md, screenshots
```

## Appendix: Early live SAM check (old /scenarios page, not /live)

This appendix describes the old `/scenarios` check of the Meta clients, run before the `/live` agent existed. It is not the `/live` agent and not the recorded-response benchmark. It is kept for reference.

**Live clients behind the existing interfaces.** Each client keeps the same interface the demo uses (`SparkClient.reason`, `SamClient.segment`, `VoiceClient.transcribe`) and calls the real Meta API:

| Client | Model | Endpoint(s) |
| :--- | :--- | :--- |
| Muse Spark | `muse-spark-1.3` | `POST /v1/chat/completions` |
| SAM 3.1 | `sam-3.1` | `POST /v1/files`, then `POST /v1/responses` |
| Muse Voice Transcribe | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` |

**Live probe.** `GET /api/meta/status?probe=1` returned `source: "live"`, `error: null` for all three clients.

**End-to-end browser check.** The **Live verification** section on the `/scenarios` page uploads a real photo with the agent's claimed object, runs live SAM 3.1 through `POST /api/guard/live-check`, and shows the Guard decision.

Screenshots of these early checks are available in the git history. Reproduce with the input photos: [`docs/test-images/red-mug.png`](./test-images/red-mug.png) and [`docs/test-images/desk.png`](./test-images/desk.png).

**The decision is still deterministic.** The Guard decision is always the unchanged `reconcile()` on a fresh ORDER-1042 ledger at step `VERIFY_MUG`. Live SAM only supplies whether the claimed object is in frame. Mock results fail closed: they are never shown as live verification and never count as verified. The clients use mocks when `SAFELABS_USE_MOCKS=true` or when keys are missing. A failed live call is reported as unavailable and is never replaced by mock output.

**Limits of this old `/scenarios` check only.**
* It checks object presence only. It does not read text in the image (`imageText` is `""`), so this check does not detect printed-sign injection. The `/live` agent reads sign text with OCR.
* SAM's placeholder box and score are not shown as real geometry or confidence.
* The ASI-MM scenario flow on `/scenarios` (PASS → attacked → BLOCKED) still runs on mock clients, as labelled.
* The live Voice test is optional and requires a mono 16-bit PCM WAV at 16 or 24 kHz.
