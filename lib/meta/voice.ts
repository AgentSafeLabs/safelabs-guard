// Muse Voice Transcribe: verifies what was actually said.

import { describeError, loadBinary, metaFetch, MetaApiError, shouldUseLive, type MetaSource } from "./http";

export interface VoiceInput {
  /**
   * Audio reference (URL or data URI). Live calls require mono 16-bit PCM WAV
   * at 16 kHz or 24 kHz; no transcoding is done here (no ffmpeg dependency).
   */
  audio: string;
  /** Mock-only: transcript to return instead of the default. */
  mockTranscript?: string;
}

export interface VoiceResult {
  transcript: string;
  confidence: number;
  /** Raw turns from the live API, when available. */
  turns?: unknown[];
  /** Where this result came from. "unavailable" (with `error`, empty transcript) means the live call failed. */
  source?: MetaSource;
  error?: string;
  /** Fixed, safe label when the transcript was discarded (e.g. "transcript not in English"). */
  perceptionDetail?: string;
}

export interface VoiceClient {
  readonly mode: "live" | "mock";
  transcribe(input: VoiceInput): Promise<VoiceResult>;
}

export const VOICE_MODEL = "muse-voice-transcribe-1.0";

export class MockVoiceClient implements VoiceClient {
  readonly mode = "mock" as const;

  async transcribe(input: VoiceInput): Promise<VoiceResult> {
    return {
      transcript: input.mockTranscript ?? "confirmed",
      confidence: 0.98,
      source: "mock",
    };
  }
}

// Muse Voice Transcribe takes no language parameter in the request this
// client sends ({mode, model, audioEncoding}); none is documented in this
// repo, so no language hint is invented here. Instead a transcript that is
// mostly non-Latin script is discarded: the guard and its injection checks
// are English-only, so it would pass through unchecked.

export const NOT_ENGLISH = "transcript not in English";

const LETTER = new RegExp("\\p{L}", "u");
const LATIN = new RegExp("\\p{Script=Latin}", "u");

/** True when more than half of the letters are outside Latin script. No letters = false. */
export function isMostlyNonLatin(text: string): boolean {
  let letters = 0;
  let latin = 0;
  for (const ch of Array.from(text)) {
    if (!LETTER.test(ch)) continue;
    letters += 1;
    if (LATIN.test(ch)) latin += 1;
  }
  return letters > 0 && latin * 2 < letters;
}

/** Parses the /v1/asr/transcribe JSON body: .transcript (required) and .turns. */
export function parseVoiceResponse(body: unknown): VoiceResult {
  const { transcript, turns } = (body ?? {}) as { transcript?: unknown; turns?: unknown };
  if (typeof transcript !== "string") {
    throw new MetaApiError("Voice parse failure: missing transcript");
  }
  return {
    transcript,
    // The API returns no confidence score; reconcile does not use it.
    confidence: 1,
    turns: Array.isArray(turns) ? turns : [],
    source: "live",
  };
}

export class LiveVoiceClient implements VoiceClient {
  readonly mode = "live" as const;

  /** timeoutMs is optional and bench-only; unset keeps metaFetch's 10 s default. */
  constructor(private readonly apiKey: string, private readonly options: { timeoutMs?: number } = {}) {}

  async transcribe(input: VoiceInput): Promise<VoiceResult> {
    try {
      const audio = await loadBinary(input.audio);
      const form = new FormData();
      form.append(
        "request",
        new Blob(
          [JSON.stringify({ mode: "ENDPOINTING", model: VOICE_MODEL, audioEncoding: "WAV" })],
          { type: "application/json" },
        ),
      );
      form.append("audio", new Blob([audio], { type: "audio/wav" }), "audio.wav");
      const sessionId = crypto.randomUUID();
      const res = await metaFetch(`/asr/transcribe?sessionId=${sessionId}`, this.apiKey, {
        method: "POST",
        body: form,
        signal: this.options.timeoutMs === undefined ? undefined : AbortSignal.timeout(this.options.timeoutMs),
      });
      const result = parseVoiceResponse(await res.json());
      if (isMostlyNonLatin(result.transcript)) {
        return { transcript: "", confidence: 0, turns: [], source: "live", error: NOT_ENGLISH, perceptionDetail: NOT_ENGLISH };
      }
      return result;
    } catch (err) {
      // A failed live call is "unavailable": an empty transcript, never the mock's "confirmed".
      return { transcript: "", confidence: 0, source: "unavailable", error: describeError(err) };
    }
  }
}

export function getVoiceClient(): VoiceClient {
  const key = process.env.META_VOICE_API_KEY;
  return shouldUseLive(key) ? new LiveVoiceClient(key) : new MockVoiceClient();
}
