// SAM 3.1: verifies which objects are actually in the frame.

import {
  describeError,
  loadBinary,
  metaFetch,
  MetaApiError,
  shouldUseLive,
  type MetaSource,
} from "./http";

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
  /** Where this result came from. "mock" with `error` means live failed. */
  source?: MetaSource;
  error?: string;
}

export interface SamClient {
  readonly mode: "live" | "mock";
  segment(input: SamInput): Promise<SamResult>;
}

export const SAM_MODEL = "sam-3.1";
const BOX_RECORD = "<|box;";

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
    return { detections, imageText: input.mockImageText ?? "", source: "mock" };
  }
}

export function countBoxRecords(text: string): number {
  return text.split(BOX_RECORD).length - 1;
}

export interface SamStreamParse {
  text: string;
  boxCount: number;
  completed: boolean;
}

/**
 * Parses raw SSE text from POST /v1/responses. Accumulates output text deltas
 * until `response.completed`; falls back to the completed response's output
 * text if no deltas were streamed.
 */
export function parseSamStream(raw: string): SamStreamParse {
  let text = "";
  let completed = false;
  for (const event of raw.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
      text += payload.delta;
    } else if (payload.type === "response.completed") {
      completed = true;
      if (!text) text = completedOutputText(payload.response);
      break;
    }
  }
  return { text, boxCount: countBoxRecords(text), completed };
}

function completedOutputText(response: unknown): string {
  const output = (response as { output?: { content?: { text?: unknown }[] }[] })?.output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

/** Reads an SSE body until response.completed (or end of stream). */
async function readSamStream(res: Response): Promise<SamStreamParse> {
  if (!res.body) return parseSamStream(await res.text());
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.includes("response.completed")) {
        const parsed = parseSamStream(raw);
        if (parsed.completed) return parsed;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return parseSamStream(raw + decoder.decode());
}

export class LiveSamClient implements SamClient {
  readonly mode = "live" as const;
  private readonly fallback = new MockSamClient();

  constructor(private readonly apiKey: string) {}

  async segment(input: SamInput): Promise<SamResult> {
    try {
      const fileId = await this.upload(input.frame);
      const detections: SamDetection[] = [];
      for (const concept of input.concepts) {
        if (await this.verifyConcept(concept, fileId)) {
          // Verification only: >=1 box record means the concept is in frame.
          // Masks/boxes are not decoded or rendered.
          detections.push({ label: concept, score: 1, box: [0, 0, 0, 0] });
        }
      }
      // SAM does not read frame text, so live imageText is empty.
      return { detections, imageText: "", source: "live" };
    } catch (err) {
      const result = await this.fallback.segment(input);
      return { ...result, source: "mock", error: describeError(err) };
    }
  }

  /** Step 1: POST /v1/files (multipart, purpose=user_data) -> file id. */
  private async upload(frame: string): Promise<string> {
    const image = await loadBinary(frame);
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append("file", image, `frame.${image.type.split("/")[1] || "png"}`);
    const res = await metaFetch("/files", this.apiKey, { method: "POST", body: form });
    const body = (await res.json()) as { id?: unknown };
    if (typeof body?.id !== "string") throw new MetaApiError("SAM parse failure: upload returned no id");
    return body.id;
  }

  /** Step 2: POST /v1/responses (SSE) with the concept and the uploaded image. */
  private async verifyConcept(concept: string, fileId: string): Promise<boolean> {
    const res = await metaFetch("/responses", this.apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: SAM_MODEL,
        stream: true,
        metadata: { mask_encoding: "lossless" },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: concept },
              { type: "input_image", file_id: fileId },
            ],
          },
        ],
      }),
    });
    const parsed = await readSamStream(res);
    if (!parsed.completed) throw new MetaApiError("SAM parse failure: stream ended before response.completed");
    return parsed.boxCount >= 1;
  }
}

export function getSamClient(): SamClient {
  const key = process.env.META_SAM_API_KEY;
  return shouldUseLive(key) ? new LiveSamClient(key) : new MockSamClient();
}
