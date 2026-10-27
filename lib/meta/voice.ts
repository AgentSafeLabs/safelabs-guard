// Muse Voice Transcribe: verifies what was actually said.

export interface VoiceInput {
  /** Audio reference (URL or data URI). */
  audio: string;
  /** Mock-only: transcript to return instead of the default. */
  mockTranscript?: string;
}

export interface VoiceResult {
  transcript: string;
  confidence: number;
}

export interface VoiceClient {
  readonly mode: "live" | "mock";
  transcribe(input: VoiceInput): Promise<VoiceResult>;
}

export class MockVoiceClient implements VoiceClient {
  readonly mode = "mock" as const;

  async transcribe(input: VoiceInput): Promise<VoiceResult> {
    return {
      transcript: input.mockTranscript ?? "confirmed",
      confidence: 0.98,
    };
  }
}

class LiveVoiceClient implements VoiceClient {
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async transcribe(): Promise<VoiceResult> {
    void this.apiKey;
    throw new Error("Muse Voice Transcribe live client not implemented");
  }
}

export function getVoiceClient(): VoiceClient {
  const key = process.env.META_VOICE_API_KEY;
  if (!key || process.env.SAFELABS_USE_MOCKS === "true") {
    return new MockVoiceClient();
  }
  return new LiveVoiceClient(key);
}
