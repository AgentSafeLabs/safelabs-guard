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
  /** Where this result came from. "mock" with `error` means live failed. */
  source?: MetaSource;
  error?: string;
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
  private readonly fallback = new MockVoiceClient();

  constructor(private readonly apiKey: string) {}

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
      });
      return parseVoiceResponse(await res.json());
    } catch (err) {
      const result = await this.fallback.transcribe(input);
      return { ...result, source: "mock", error: describeError(err) };
    }
  }
}

export function getVoiceClient(): VoiceClient {
  const key = process.env.META_VOICE_API_KEY;
  return shouldUseLive(key) ? new LiveVoiceClient(key) : new MockVoiceClient();
}
