// Request limits shared by the billed routes (/api/agent/turn,
// /api/guard/live-check) and /api/packproof/ship. One place, so the routes
// and their tests cannot drift apart.

export const MB = 1024 * 1024;

/** One uploaded frame. The client re-encodes camera frames below this. */
export const MAX_IMAGE_BYTES = 8 * MB;
/** One WAV clip. The mic recorder stops at 15 s of 16 kHz mono 16-bit (about 0.5 MB). */
export const MAX_AUDIO_BYTES = 1 * MB;
/** Largest decoded image (width x height). sharp's own default is about 268 MP. */
export const MAX_IMAGE_PIXELS = 50_000_000;

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** /api/agent/turn: one image, one clip and a few small fields. */
export const MAX_TURN_BODY_BYTES = MAX_IMAGE_BYTES + MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES;
/** /api/guard/live-check: whole body, image and clip together (unchanged: 8 MB). */
export const MAX_LIVE_CHECK_BODY_BYTES = 8 * MB;
/** /api/packproof/ship: {"approval": "<token>"}; a token is at most 2048 characters. */
export const MAX_JSON_BODY_BYTES = 4 * 1024;

/** Accepted WAV: the format lib/meta/voice.ts sends upstream. */
export const WAV_SAMPLE_RATES = [16_000, 24_000] as const;

/** Probes of /api/meta/status?probe=1 (3 paid calls each) allowed per instance per hour. */
export const MAX_PROBES_PER_HOUR = 3;
