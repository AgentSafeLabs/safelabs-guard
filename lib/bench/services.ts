// The benchmark's external services, each behind the Recorder. Only parsed
// results are recorded:
//   sam              {detected: boolean} per (image, concept)
//   voice            {transcript: string, ok: boolean} per audio file
//   spark-reasoning  {content: string} per exact message list
// Live calls go through the app's own clients (lib/meta, lib/agent/packproof).

import type { ReasoningClient, ReasoningRequest, SparkReasoningClient } from "../agent/packproof";
import { SPARK_REASONING_PARAMS } from "../agent/packproof";
import { SAM_MODEL, type SamClient, type SamResult } from "../meta/sam";
import { SPARK_MODEL } from "../meta/spark";
import { VOICE_MODEL, type VoiceClient } from "../meta/voice";
import { canonicalJson, sha256Hex, type KeyInput, type Recorder } from "./recorder";

export interface Media {
  /** Relative to bench/. */
  path: string;
  bytes: Uint8Array;
  sha256: string;
  dataUrl: string;
}

export const SAM_PARAMS = Object.freeze({ mask_encoding: "lossless" });
export const VOICE_PARAMS = Object.freeze({ mode: "ENDPOINTING", audioEncoding: "WAV" });

export interface SamRecording {
  detected: boolean;
}
export interface VoiceRecording {
  transcript: string;
  /** false when the transcript was discarded (e.g. not English); the guarded route then fails closed. */
  ok: boolean;
}
export interface ReasoningRecording {
  content: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isSamRecording = (v: unknown): v is SamRecording => isObject(v) && typeof v.detected === "boolean";
export const isVoiceRecording = (v: unknown): v is VoiceRecording =>
  isObject(v) && typeof v.transcript === "string" && typeof v.ok === "boolean";
export const isReasoningRecording = (v: unknown): v is ReasoningRecording => isObject(v) && typeof v.content === "string";

export function samKey(image: Media, concept: string): KeyInput {
  return { service: "sam", model: SAM_MODEL, promptHash: sha256Hex(concept), params: { ...SAM_PARAMS }, inputSha256: image.sha256 };
}

export function voiceKey(audio: Media): KeyInput {
  return { service: "voice", model: VOICE_MODEL, promptHash: null, params: { ...VOICE_PARAMS }, inputSha256: audio.sha256 };
}

export function reasoningKey(messages: ReasoningRequest["messages"]): KeyInput {
  return {
    service: "spark-reasoning",
    model: SPARK_MODEL,
    promptHash: sha256Hex(canonicalJson(messages)),
    params: { ...SPARK_REASONING_PARAMS },
    inputSha256: null,
  };
}

/**
 * SAM for one image and a list of concepts. Concepts without a recording are
 * asked in ONE live segment() call (one upload, one request per concept), and
 * each concept's answer is saved on its own. A result that is not live, or
 * that carries an error, is a hard error and is never saved.
 */
export async function detectObjects(
  recorder: Recorder,
  image: Media,
  concepts: readonly string[],
  liveSam: () => SamClient,
): Promise<SamResult> {
  const missing = recorder.mode === "live" ? [...concepts] : concepts.filter((c) => !recorder.has(samKey(image, c)));
  const fresh = new Map<string, boolean>();
  if (missing.length && recorder.mode !== "replay") {
    recorder.liveCalls += 1 + missing.length;
    const result = await liveSam().segment({ frame: image.dataUrl, concepts: missing });
    if (result.source !== "live" || result.error) {
      throw recorder.fail(new Error(`Live SAM failed for ${image.path}; nothing was recorded`));
    }
    for (const concept of missing) {
      const detected = result.detections.some((d) => d.label === concept);
      fresh.set(concept, detected);
      if (recorder.mode === "record") recorder.write(samKey(image, concept), { detected });
    }
  }
  const detections: SamResult["detections"] = [];
  for (const concept of concepts) {
    const detected = fresh.has(concept)
      ? fresh.get(concept)
      : (await recorder.call(samKey(image, concept), async () => {
          throw new Error("unreachable: SAM is asked in one batch");
        }, isSamRecording)).detected;
    // Live SAM reports presence only, with score 1 (lib/meta/sam.ts).
    if (detected) detections.push({ label: concept, score: 1, box: [0, 0, 0, 0] });
  }
  return { detections, imageText: "", source: "live" };
}

/** Transcribes one clip. A live failure (other than a discarded transcript) is a hard error. */
export async function transcribe(recorder: Recorder, audio: Media, liveVoice: () => VoiceClient): Promise<VoiceRecording> {
  return recorder.call(
    voiceKey(audio),
    async () => {
      const heard = await liveVoice().transcribe({ audio: audio.dataUrl });
      if (heard.source !== "live") throw new Error(`Live voice failed for ${audio.path}`);
      // A live result with an error is a discarded transcript (e.g. not English): fixed label, no text.
      return heard.error ? { transcript: "", ok: false } : { transcript: heard.transcript, ok: true };
    },
    isVoiceRecording,
  );
}

/**
 * A ReasoningClient that sends exactly what `spark` would send (its
 * messagesFor(), so a systemPrompt override is part of the key) through the
 * recorder. Never sends the frame.
 */
export class RecordedReasoningClient implements ReasoningClient {
  readonly name = "spark";
  readonly acceptsImages = false;
  /** The exact messages of every request, for tests and the results file. */
  readonly sent: ReasoningRequest["messages"][] = [];

  constructor(
    private readonly recorder: Recorder,
    private readonly spark: Pick<SparkReasoningClient, "messagesFor" | "complete">,
  ) {}

  async complete(request: ReasoningRequest): Promise<string> {
    const messages = this.spark.messagesFor(request);
    this.sent.push(messages);
    const { content } = await this.recorder.call(
      reasoningKey(messages),
      async () => ({ content: await this.spark.complete(request) }),
      isReasoningRecording,
    );
    return content;
  }
}
