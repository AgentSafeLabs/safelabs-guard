# PackProof live agent and status

How the PackProof live agent works and what has been verified, piece by piece. Moved out of the [README](../README.md).

## How the live agent works

The live agent page is separate from the mock-perception scenarios on `/scenarios`. It runs the PackProof agent as a real loop: each turn it **perceives** (SAM 3.1 objects, text read from the frame, Voice transcript), **decides** (Muse Spark proposes ADVANCE / SEAL / SHIP / HOLD) and **acts**. In **Guarded** mode, every proposed action goes through `guardAction()`, which allows only the one action legal at the current ledger step and then calls the unchanged `reconcile()`; [Decisions](../README.md#decisions) covers the outcomes and Unguarded mode. A SHIP that the guard ALLOWs returns a short-lived signed approval, and only that approval can create the (simulated) shipment.

* **Fail closed.** If image text, SAM or Voice is unavailable, the guarded turn is blocked (Spark is not consulted) and executes nothing.
* **Server-derived state.** The client sends only a mode, a signed session token and media. Perception, transcript and ledger position are derived on the server.
* **Production refuses mock perception.** `/api/agent/turn` and `/api/packproof/ship` return 503 in production unless `SAFELABS_USE_MOCKS=false`.
* **Typed text is not accepted.** Only transcripts produced from recorded audio are used.

## PackProof status

"Manual production run" means a single manual run (not a rate) on https://guard.agentsafelabs.com/live on Oct 30-31, 2026, in a real browser in upload-image mode, with SAM, image text, Spark and voice all live. "Recorded benchmark" means the recorded Meta responses in `bench/` replayed offline (synthetic media), not a live-model run.

| Piece | Built | Verified in a real browser | Verified against live Meta |
| :--- | :--- | :--- | :--- |
| Agent loop (perceive, decide, act) with action gate | yes, unit tests on fakes | yes: a full guarded run through all five steps to a simulated shipment | manual production run; recorded benchmark |
| Guarded outcome on printed-sign injection | yes, unit and route tests on stubbed Meta | yes: two printed injection signs flagged and held, ledger did not advance | manual production run; recorded benchmark |
| Spoken injection | yes, unit and route tests on stubbed Meta | yes: a spoken command in Unguarded mode and a split sign + speech case, with the voice shadow banner | manual production run; recorded benchmark |
| Unguarded mode | yes, unit tests | yes: Spark held on 4 printed signs and 1 spoken command; the shadow banner showed what the guard would have flagged. With a banana or laptop at the mug step it advanced and the ledger moved | manual production run |
| Non-English voice | yes, unit tests | yes: BLOCK "voice unavailable" (transcript not in English), every badge unavailable, the turn failed closed | manual production run |
| Silence / no usable transcript | yes, unit tests | yes: ALLOW (silence is allowed) | manual production run |
| Client-side file limits | yes: the page accepts JPEG or PNG up to 8 MB (client-side messages); the API also accepts WebP; unit tests in `lib/client/upload.test.ts` | yes: seen on the production page | manual production run |
| Missing item held while the voice said "confirmed" | yes | yes | manual production run |
| Signed session tokens and SHIP approvals | yes, unit tests | yes: used in the full run | manual production run |
| Simulated shipment (`/api/packproof/ship`) | yes, route tests | yes: created in the full run | manual production run |
| Reading sign text from the frame (OCR, tesseract.js) | yes; reads can miss text (see Limits) | yes: injection and benign signs read on production | manual production run; recorded benchmark |
| Voice transcript (Muse Voice Transcribe) | yes | yes: live voice used in the production runs | manual production run; recorded benchmark |
| Camera capture to JPEG (`/live`) | sizing logic unit-tested; no test of the camera API | not yet | not yet |
| Microphone to WAV (Record voice button) | encoder unit-tested | not yet | not yet |
| Rate limit, daily live-call cap, kill switch (in-memory, per instance) | yes, unit tests | request-level abuse checks on production: 55 pass, 2 known fails | n/a |
| Production refusal of mock mode | yes, unit tests | not separately checked | n/a |
| Image input to Muse Spark | OCR is the live default. `SAFELABS_VISION=spark` and `SAFELABS_SPARK_IMAGES` are optional and off in production; Spark image input is unconfirmed | not yet | not yet |

Not verified: live camera capture, microphone recording in a browser, real-photo accuracy, and a shared (global) rate-limit budget.

Other limits are under [Limits](../README.md#limitations-and-known-issues). Explicit mock mode is under [Quick Start](../README.md#quick-start).
