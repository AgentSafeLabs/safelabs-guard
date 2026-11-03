# Integrating the Guard into your own agent

## 1. Status

This repository is a reference implementation, not a packaged SDK. There is no npm package, no hosted API for third-party agents and no non-TypeScript client today. The ledger in the demo is fixed to ORDER-1042 (mug, notebook, cable, seal, ship). Planned work is listed in the [Roadmap](../README.md#roadmap); what the Guard does not do is in [Limits](../README.md#limitations-and-known-issues).

Source: `package.json:2-4` (`"private": true`); `lib/guard/ledger.ts:21-27,41-48`.

## 2. Integration options

| Option | Status |
| :--- | :--- |
| (a) Embed the guard core in a Node/TypeScript agent | Available. Copy or import from `lib/guard/`. |
| (b) Follow the PackProof pattern | Available. `lib/agent/run.ts` is a working perceive, propose, guard, execute loop. |
| (c) Call the demo HTTP routes | Available as a reference only. Bound to the demo session and ORDER-1042; in production only an allow-listed browser origin is accepted (section 7). |
| (d) Hosted API or SDK for other languages | Not available yet. |

## 3. The pattern

See the flow diagram at the top of the [README](../README.md). One turn:

1. Perceive: get the objects in the frame, the text in the frame and the voice transcript from components that are independent of the model.
2. Propose: the model reads a text report of that perception and proposes one action.
3. Guard: pass the same perception, the ledger state and the proposed action to `guardAction()`.
4. Execute only on ALLOW, and move the ledger to the `nextState` the guard returned.

Anything other than ALLOW must not execute. Fail closed: in guarded mode, if SAM or the image-text read (OCR) is unavailable, the turn is a BLOCK and Spark is not consulted. In the HTTP route, a voice clip that was sent but not transcribed is also a BLOCK ("voice unavailable") before the turn runs.

Source: `lib/agent/run.ts:97-127,164-175,186-202` (perceive, fail closed, act); `lib/agent/run.ts:79-84` (Spark "not consulted"); `lib/server/agent-turn.ts:315-316` (voice); `lib/agent/tools.ts:44-47` (`executeGuarded` runs nothing unless ALLOW).

## 4. Using the guard core

Import (relative path; `tsconfig.json` also maps `@/*` to the repo root):

```ts
import { guardAction } from "./lib/guard/action-gate";
import { createLedger, type LedgerState } from "./lib/guard/ledger";
```

**Input** (`ActionGateInput`, which extends `ReconcileInput`):

| Field | Type | Notes |
| :--- | :--- | :--- |
| `ledgerState` | `LedgerState` | Must be a state the ledger module issued. |
| `sparkClaimedObjects` | `readonly string[]` | Objects the model claims are present. At most 100 entries. |
| `samDetectedObjects` | `readonly string[]` | Objects the detector found. |
| `voiceTranscript` | `string` | `""` when nothing was said. |
| `imageText` | `string` | Text read from the frame. |
| `samConfidence` | `number` (optional) | Only validated (0 to 1); not used in the decision. |
| `proposedAction` | `"ADVANCE" \| "SEAL" \| "SHIP" \| "HOLD"` | `AgentAction`. |

`LedgerState` is `{ orderId, stepIndex, step, status }`, with `status` `"IN_PROGRESS" | "COMPLETE"`.

**Output** (`ActionGateResult`): `decision` (`"ALLOW" | "BLOCK" | "HOLD"`), `reason` (string) and `nextState` (a `LedgerState`, present only on ALLOW). `reconcile()` additionally returns `allow`, a proof object that `reconcile()` has already consumed (it cannot be redeemed again).

The guard core returns no record beyond the result above. In the demo, the per-turn record is the `TurnRecord` built by `runTurn()` and returned in the `/api/agent/turn` response; it is not written to a store or a server log (the server logs only a timing line), so persist it yourself if you need an audit trail. Fields: `turn`, `mode`, `step`, `observation`, `sparkDecision`, `perception`, `guard` (`{ decision, reason }` or `null` when unguarded), `executed`, `shipped`, `ledgerStepAfter`. Image text and transcript in it pass through `redact()`.

```ts
import type { AgentAction } from "./lib/agent/types";

let ledger: LedgerState = createLedger();

function runStep(proposed: AgentAction, perception: { objects: string[]; imageText: string; transcript: string }, claimed: string[]) {
  const gate = guardAction({
    ledgerState: ledger,
    sparkClaimedObjects: claimed,
    samDetectedObjects: perception.objects,
    voiceTranscript: perception.transcript,
    imageText: perception.imageText,
    proposedAction: proposed,
  });
  if (gate.decision !== "ALLOW" || !gate.nextState) return gate; // HOLD and BLOCK run nothing
  // ...perform the real action here...
  ledger = gate.nextState;
  return gate;
}
```

**What the guard checks, in order:** valid ledger and not COMPLETE; injection in image text, in the voice transcript, and in both joined; detected objects equal to the step's expected objects (missing or unexpected); the model's claim equal to the detected objects; the transcript is empty or made only of allow-listed confirmations. `reconcile()` never throws: bad input or an internal error is a BLOCK.

**The ledger** is a state machine. States are frozen and only states the ledger issued are accepted, so a state forged from JSON or model output is rejected. `advance()` accepts only an ALLOW decision that `reconcile()` minted, and each can be redeemed once. Nothing that takes free text can write to it. Only ALLOW advances it. `createLedgerAtStep()` can start anywhere; it takes a step name, never free text.

Source: `lib/guard/action-gate.ts:21-39`; `lib/guard/reconcile.ts:12-30,152-221,223-230`; `lib/guard/ledger.ts:1-17,50-57,100-107,123-152`; `lib/agent/types.ts:15,60-80`; `lib/agent/run.ts:136-162`; `tsconfig.json:21-23`.

## 5. Decisions your agent must handle

| Decision | What your agent should do |
| :--- | :--- |
| ALLOW | Perform the action and move the ledger to `nextState`. |
| HOLD | The agent's own choice (`proposedAction` was `HOLD`, reason "Agent chose to hold"). Do nothing; try again with new input. The guard may still record injected text it saw. |
| BLOCK | The Guard refused: an illegal action for the step ("Action not allowed at this step"), a perception mismatch, an injection, an unusable voice clip, or perception unavailable. Do nothing. Log the `reason`; do not retry the same evidence. |

If the model call fails, the demo turns it into a HOLD, so nothing executes.

**Signed SHIP approval.** When a guarded turn at the SHIP step is ALLOWed with the proposed action SHIP and `executed` is `"SHIP"`, the turn route returns an `approval` string: an HMAC-SHA256 signed token (`{ v, type: "approval", action: "SHIP", orderId, jti, iat, exp }`) valid for 5 minutes (`APPROVAL_TTL_SECONDS = 5 * 60`). The ship route accepts only a valid, unexpired approval for ORDER-1042. It is not single use at the token level: the code states single-use needs a durable store that does not exist yet. The shipment is a pure function of the approval, so presenting the same approval again returns the identical record, but a second approval from a second guarded run would create another shipment for the same order. Sessions are signed tokens too, valid for 30 minutes and replayable until they expire.

Source: `lib/guard/action-gate.ts:32-37`; `lib/agent/types.ts:30-41`; `lib/agent/approval.ts:1-10,12-20,33-47,49-62,64-81`; `lib/server/agent-turn.ts:347-356`; `lib/server/ship.ts:1-15,29-37`; `lib/agent/session-token.ts:1-5,14`.

## 6. Adapting it to another workflow

Hard-coded for PackProof today, and the file to change:

| What | Where |
| :--- | :--- |
| Steps `VERIFY_MUG`, `VERIFY_NOTEBOOK`, `VERIFY_CABLE`, `SEAL`, `SHIP` and `ORDER_1042` | `lib/guard/ledger.ts:21-27,41-48` |
| Objects expected at each step | `lib/guard/ledger.ts:73-80` |
| Legal action per step | `lib/guard/action-gate.ts:9-15` |
| Action names `ADVANCE`, `SEAL`, `SHIP`, `HOLD` | `lib/agent/types.ts:15-17` |
| Voice allowlist (`CONFIRMATIONS`, `FILLERS`, 12-word limit) | `lib/guard/reconcile.ts:57-73` |
| Extra objects SAM is asked about: `ROUTE_DISTRACTORS` (`banana`, `laptop`) on the route; `DISTRACTORS` in `run.ts` | `lib/server/agent-turn.ts:37`; `lib/agent/run.ts:27` |
| Model prompt (names PackProof, ORDER-1042 and the steps) | `lib/agent/packproof.ts:83-105` |
| SAM alias `usb-c cable` to `usb cable` | `lib/meta/sam.ts:53-55` |
| Session and approval tied to ORDER-1042 | `lib/agent/session-token.ts:80`; `lib/agent/approval.ts:49-79` |

`createLedger(order)` accepts another `Order`, but only the order id changes: the steps and expected objects stay the PackProof ones. Configurable ledgers and product sets are not available yet (Roadmap). The injection patterns are English only.

Source: `lib/guard/ledger.ts:100-107`; `lib/guard/injections.ts` (pattern list).

## 7. HTTP routes (demo reference)

All routes are bound to the demo order and session. In production, `POST` routes accept a browser `Origin` only if it is on the allow-list (`SAFELABS_ALLOWED_ORIGINS`, default `https://guard.agentsafelabs.com`), or no `Origin` with `Sec-Fetch-Site: same-origin`; anything else is 403. A script that sets no suitable header is refused in production. Outside production, localhost origins and requests with no `Origin` are accepted. Source: `lib/server/origin.ts:3-17,52-62`.

**`POST /api/agent/turn`** (`multipart/form-data`). Fields: `mode` (`guarded` or `unguarded`, required), `session` (token from the previous response, optional), `image` (PNG/JPEG/WebP, optional), `audio` (WAV, optional). Response 200 JSON: `turn` (the `TurnRecord`), `session`, `ledger` (`step`, `stepIndex`, `status`), `shipped`, `sources` (`sam`, `voice`, `vision`, `spark`: `live`, `mock` or `unavailable`), `perceptionDetail`, `securityEvents` (display only; never changes a decision) and `approval` (only after an ALLOWed SHIP). Status codes: 503 (production without `SAFELABS_USE_MOCKS=false`, kill switch on in production, or signing not configured), 403 (origin), 429 (per-IP limit with `Retry-After`; or "Daily live budget exhausted"), 415 (not multipart), 413 (body too large), 400 (bad `mode`, unparseable body, bad image or audio, session mode mismatch), 401 (invalid or expired session), 500. Max duration 60 s. Source: `app/api/agent/turn/route.ts:1-27`; `lib/server/agent-turn.ts:200-244,276-278,399-416`; `lib/server/runtime-mode.ts:35-53`.

**`POST /api/packproof/ship`** (`application/json`). Body: `{ "approval": "<token>" }`. Response 200: `{ shipment: { shipmentId, orderId, createdAt }, status: "shipment" }`. Status codes: 503 (production refusal or signing not configured), 403 (origin, or "Approval rejected" with a `reason`), 429, 415, 413 (over 4 KB), 400 (invalid JSON or not an object), 500. Source: `app/api/packproof/ship/route.ts:1-19`; `lib/server/ship.ts:23-61`.

**`POST /api/guard/live-check`** (`multipart/form-data`). Fields: `image` (required), `claimedObject` (required text, at most 80 characters), `audio` (optional WAV). Runs one check on a fresh ledger at `VERIFY_MUG`. Response 200: `LiveCheckResult` (`ledgerStep`, `expectedObjects`, `claimedObject`, `sam`, `voice`, `decision`, `reason`). Status codes: 503 (kill switch, with `decision: "BLOCK"`), 403, 429 (rate or daily budget, with `decision: "BLOCK"`), 415, 413 (over 8 MB), 400, 500. It does not apply the production mock refusal. Source: `app/api/guard/live-check/route.ts:1-101`; `lib/live/check.ts:24-45`.

**`GET /api/meta/status`**. No parameters: JSON with `useMocks` and, for `spark`, `sam` and `voice`, `mode` and `keySet`. With `?probe=1`: makes live calls only with header `x-safelabs-admin` equal to `SAFELABS_ADMIN_TOKEN`; 503 (kill switch), 429 (rate, probes or daily budget), 404 (no admin token configured), 403 (wrong token). Source: `app/api/meta/status/route.ts:1-11,58-102`; `lib/server/admin.ts:9`.

**Request limits**

| Limit | Value | Source |
| :--- | :--- | :--- |
| Image | 8 MB; PNG, JPEG or WebP by magic bytes and readable header; at most 50,000,000 pixels | `lib/server/limits.ts:8,12`; `lib/server/request-guard.ts:105-127` |
| Audio | 1 MB; WAV, mono 16-bit PCM, 16 kHz or 24 kHz | `lib/server/limits.ts:10,24`; `lib/server/request-guard.ts:135-152` |
| Turn body | 8 MB + 1 MB + 64 KB | `lib/server/limits.ts:14-17` |
| Live-check body | 8 MB | `lib/server/limits.ts:19` |
| Ship body | 4 KB | `lib/server/limits.ts:21` |
| Rate limit, turn, live-check, probe | 8 per IP per 60 s sliding window (default) | `lib/server/rate-limit.ts:16-17,42-43` |
| Rate limit, ship (separate bucket) | 20 per IP per 60 s (default) | `lib/server/rate-limit.ts:18,43-44` |
| Daily cap | 300 live Meta calls per UTC day, all callers (default) | `lib/server/rate-limit.ts:19,61-71` |
| Probes | 3 per hour per instance | `lib/server/limits.ts:27` |
| Kill switch | `SAFELABS_LIVE_DISABLED=true` forces mocks | `lib/server/rate-limit.ts:73-75` |

`SAFELABS_RATE_LIMIT_PER_MIN` overrides both rate limits. Rate limits, the daily cap and the kill switch are in memory per server instance, not global.

## 8. Configuration

Names only. Set values in `.env.local`; never commit them. Source: `.env.example:1-50`.

| Variable | Purpose | Needed for live mode |
| :--- | :--- | :--- |
| `META_SPARK_API_KEY` | Muse Spark (reasoning) key | Yes |
| `META_SAM_API_KEY` | SAM 3.1 (objects) key | Yes |
| `META_VOICE_API_KEY` | Muse Voice Transcribe key | Yes |
| `SAFELABS_USE_MOCKS` | `false` for live; `true` is explicit mock mode | Yes (`false`) |
| `SAFELABS_ALLOW_MOCK_IN_PRODUCTION` | `true` allows a labelled mock-only production deploy | No |
| `SAFELABS_VISION` | Image text reader: `mock`, `spark` or `ocr` (default `ocr` in live mode) | No |
| `SAFELABS_SPARK_IMAGES` | `true` also sends the frame to Spark | No |
| `SAFELABS_TOKEN_SECRET` | HMAC key, at least 32 characters | Required in production |
| `SAFELABS_RATE_LIMIT_PER_MIN` | Per-IP requests per minute | No |
| `SAFELABS_DAILY_CAP` | Live Meta calls per UTC day | No |
| `SAFELABS_LIVE_DISABLED` | Kill switch | No |
| `SAFELABS_ADMIN_TOKEN` | Enables `?probe=1` on the status route | No |

Also read by the code but not listed in `.env.example`: `SAFELABS_ALLOWED_ORIGINS` (`lib/server/origin.ts:35`), `META_BASE_URL`, `META_TIMEOUT_MS`, `SAFELABS_OCR_PASSES` and `SAFELABS_SPARK_MAX_TOKENS` (`lib/agent/packproof.ts:130`).

**Mock behaviour**, as in the README [Quick Start](../README.md#quick-start): with `SAFELABS_USE_MOCKS=true`, mock perception allows any valid image on `/live`. Unset, with no keys: the dev server does not return 503, but guarded turns fail closed with BLOCK. `SAFELABS_USE_MOCKS=false` with all three keys is live mode. Production builds refuse the turn and ship routes with 503 unless `SAFELABS_USE_MOCKS=false`. Source: `lib/server/runtime-mode.ts:35-72`.

## 9. Testing an integration

```bash
npm test               # vitest run
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run bench:replay   # 40-case recorded-response report, no live calls
npm run benchmark      # 30-case ASI-MM mock regression
```

Source: `package.json:5-19`. Benchmark numbers describe this demo only (ORDER-1042, synthetic media, small samples). They are not a guarantee for another workflow; see [Results](../README.md#evaluation-and-benchmark-results).
