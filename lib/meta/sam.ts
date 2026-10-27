// SAM 3.1: verifies which objects are actually in the frame.

export interface SamInput {
  /** Frame reference (URL or data URI). */
  frame: string;
  /** Concept prompts to segment, e.g. ["red mug", "blue notebook"]. */
  concepts: string[];
  /** Mock-only: detections to return instead of the default. */
  mockDetections?: SamDetection[];
  /** Mock-only: text printed in the frame (e.g. an injected sign). */
  mockImageText?: string;
}

export interface SamDetection {
  label: string;
  score: number;
  /** [x, y, width, height] in pixels. */
  box: [number, number, number, number];
}

export interface SamResult {
  detections: SamDetection[];
  /** Any text visible in the frame, passed to injection checks. */
  imageText: string;
}

export interface SamClient {
  readonly mode: "live" | "mock";
  segment(input: SamInput): Promise<SamResult>;
}

export class MockSamClient implements SamClient {
  readonly mode = "mock" as const;

  async segment(input: SamInput): Promise<SamResult> {
    const detections =
      input.mockDetections ??
      input.concepts.map((label, i) => ({
        label,
        score: 0.95,
        box: [40 + i * 120, 80, 100, 100] as [number, number, number, number],
      }));
    return { detections, imageText: input.mockImageText ?? "" };
  }
}

class LiveSamClient implements SamClient {
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async segment(): Promise<SamResult> {
    void this.apiKey;
    throw new Error("SAM 3.1 live client not implemented");
  }
}

export function getSamClient(): SamClient {
  const key = process.env.META_SAM_API_KEY;
  if (!key || process.env.SAFELABS_USE_MOCKS === "true") {
    return new MockSamClient();
  }
  return new LiveSamClient(key);
}
