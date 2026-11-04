# Configuration

Environment variables and mock-vs-live modes for SafeLabs Guard. Copy `.env.example` to `.env.local` for local development. Never commit real values.

## Mock vs live

Live calls happen only when `SAFELABS_USE_MOCKS` is exactly `false` AND the client's key is set. Any other value (including unset) uses mock clients.

| `SAFELABS_USE_MOCKS` | Behavior |
| :--- | :--- |
| `true` (the value in `.env.example`) | Explicit mock mode, for local demos only. Mock perception assumes every frame shows the expected items, so any valid image is allowed on `/live`. |
| unset, no Meta keys | Mock clients, but guarded turns fail closed with BLOCK, since perception is not live. In `npm run dev` the server does not return 503; that refusal applies only in production builds (`next start`, Vercel). `/scenarios` runs on mock perception, as labelled. |
| `false` with all three Meta keys set | Live mode. |

In production (`NODE_ENV=production` or `VERCEL_ENV=production`, which includes `next start` and Vercel previews), `/api/agent/turn` and `/api/packproof/ship` return 503 unless `SAFELABS_USE_MOCKS=false`. Set `SAFELABS_ALLOW_MOCK_IN_PRODUCTION` to exactly `true` only for a deliberate, labelled mock-only deploy.

## Variables

| Variable | Purpose |
| :--- | :--- |
| `META_SPARK_API_KEY` | Muse Spark key. Server-side only; blank uses mocks. |
| `META_SAM_API_KEY` | SAM 3.1 key. Server-side only; blank uses mocks. |
| `META_VOICE_API_KEY` | Muse Voice Transcribe key. Server-side only; blank uses mocks. |
| `SAFELABS_USE_MOCKS` | Live vs mock, as above. |
| `SAFELABS_ALLOW_MOCK_IN_PRODUCTION` | Allows a mock-only production deploy when exactly `true`. |
| `SAFELABS_VISION` | How text in the frame is read: `mock` (default), `spark` (Muse Spark image input; run `npx tsx scripts/agent-demo.ts --probe-spark-image` first) or `ocr` (needs tesseract.js installed). In live mode, `mock` cannot read real frames, so every guarded turn BLOCKs. |
| `SAFELABS_SPARK_IMAGES` | `true` also sends the frame to Spark reasoning as an image part (unverified). |
| `SAFELABS_TOKEN_SECRET` | HMAC-SHA256 key for signed session and SHIP approval tokens, at least 32 characters. Required in production, at least 32 characters; production refuses to run without it. Outside production, if it is missing or shorter than 32 characters, a random per-process secret is used and a warning is logged. In `next dev` the turn route and the ship route can then end up with different random secrets, so the Ship step fails with "The ship approval was rejected (... bad signature)". Set it locally too. Generate with `openssl rand -hex 32`. |
| `SAFELABS_RATE_LIMIT_PER_MIN` | Requests per IP per sliding minute on `/api/agent/turn`, `/api/guard/live-check` and the status probe (default 8), and on `/api/packproof/ship` (default 20). Setting it overrides both. In-memory, per server instance, best effort. |
| `SAFELABS_DAILY_CAP` | Live Meta calls per UTC day across all callers (default 300). In-memory, per server instance. |
| `SAFELABS_LIVE_DISABLED` | Kill switch. `true` forces mock clients everywhere and labels every source "mock". In production this makes the agent routes return 503 (unless mock is allowed above). |
| `SAFELABS_ADMIN_TOKEN` | `GET /api/meta/status?probe=1` makes live Meta calls only when the request sends header `x-safelabs-admin` with exactly this value. Blank means probing is off (status is config-only). Generate with `openssl rand -base64 32`. |

See also [Request-hardening checks](REQUEST-HARDENING.md) and the [README](../README.md#quick-start).
