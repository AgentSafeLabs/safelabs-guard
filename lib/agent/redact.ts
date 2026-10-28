// Makes free text safe to put in a TurnRecord or a log line: strips data URLs
// and bearer tokens, and caps the length.

const DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+[^\s"'`)]*/gi;
const BEARER = /bearer\s+[a-z0-9._~+/=-]+/gi;
const MAX_LEN = 300;

export function redact(text: string): string {
  const cleaned = text.replace(DATA_URL, "[data-url]").replace(BEARER, "Bearer [redacted]");
  return cleaned.length > MAX_LEN ? `${cleaned.slice(0, MAX_LEN)}…` : cleaned;
}
