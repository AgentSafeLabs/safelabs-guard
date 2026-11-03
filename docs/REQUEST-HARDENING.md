# Request-hardening checks

Request-level limits and a scripted abuse test for the SafeLabs Guard routes. Moved out of the [README](../README.md).

## Automated request-hardening checks (not a security audit)

These are request-level limits and a scripted abuse test. They are not a security audit or a penetration test.

* **Request size and type limits.** An image is at most 8 MB (PNG, JPEG or WebP, checked by content) and 50 megapixels. On `/api/guard/live-check` the whole body, image and clip together, is at most 8 MB; on `/api/agent/turn` the body is at most about 9 MB (8 MB image, 1 MB clip, small fields). A WAV clip is at most 1 MB, mono 16-bit at 16 or 24 kHz. The ship request body is at most 4 KB.
* **Origin checks.** In production, billed and state-changing POST routes accept a browser request only from an allowed origin. This stops other websites from using visitors' browsers to call the paid routes. It does not stop a scripted client.
* **Per-IP rate limit.** 8 requests per minute on the routes that can spend live calls (`/api/agent/turn`, `/api/guard/live-check`, status probe) and 20 per minute on the ship route, by default. `SAFELABS_RATE_LIMIT_PER_MIN` overrides both. Status probes are also limited to 3 per instance per hour.
* **Daily cap.** At most 300 live Meta calls per UTC day, all callers (default).
* **Admin kill switch.** Setting `SAFELABS_LIVE_DISABLED` turns live calls off; an admin header with a secret token controls it.
* **Generic errors.** Responses carry fixed messages, not upstream error text, keys or raw bodies. Server logs carry the error name (and, for agent turns, a redacted message), not request content.
* **Abuse-test script.** An abuse-test script run against production: 55 checks pass, 2 are known fails, both documented limits: the public `/api/meta/status` body still reports whether Meta keys are set and whether mocks are on, and the app does not yet send browser security headers (`nosniff`, framing, referrer).
