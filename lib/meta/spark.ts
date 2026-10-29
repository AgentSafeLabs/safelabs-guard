// Muse Spark: reasons over the current PackProof step and claims what it sees.
// Its output is advisory only and never writes to the ledger.

import { describeError, metaFetch, MetaApiError, shouldUseLive, type MetaSource } from "./http";

export interface SparkInput {
  orderId: string;
  step: string;
  /** Frame reference (URL or data URI). */
  frame?: string;
  transcript?: string;
  /** Mock-only: claim to return instead of the default. */
  mockClaim?: SparkClaim;
}

export interface SparkClaim {
  /** Object labels Spark says are in the frame. */
  objects: string[];
  /** Action Spark proposes next, e.g. "SEAL_BOX". */
  proposedAction: string;
  rationale: string;
  /** Where this claim came from. "unavailable" (with `error`, no objects) means the live call failed. */
  source?: MetaSource;
  error?: string;
}

export interface SparkClient {
  readonly mode: "live" | "mock";
  reason(input: SparkInput): Promise<SparkClaim>;
}

export const SPARK_MODEL = "muse-spark-1.3";

export class MockSparkClient implements SparkClient {
  readonly mode = "mock" as const;

  async reason(input: SparkInput): Promise<SparkClaim> {
    if (input.mockClaim) return { ...input.mockClaim, source: "mock" };
    return {
      objects: ["red mug", "blue notebook", "usb-c cable"],
      proposedAction: input.step,
      rationale: "Mock: all expected items visible.",
      source: "mock",
    };
  }
}

const SYSTEM_PROMPT =
  "You are the PackProof packing agent. Reply with ONLY a JSON object: " +
  '{"objects": string[] (lowercase labels of items in the box), ' +
  '"proposedAction": string, "rationale": string}.';

/** Parses a /v1/chat/completions body: choices[0].message.content must hold the claim JSON. */
export function parseSparkResponse(body: unknown): SparkClaim {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message
    ?.content;
  if (typeof content !== "string") {
    throw new MetaApiError("Spark parse failure: missing choices[0].message.content");
  }
  // Tolerate ```json fences or prose around the object.
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new MetaApiError("Spark parse failure: no JSON object in content");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new MetaApiError("Spark parse failure: invalid JSON in content");
  }
  const { objects, proposedAction, rationale } = parsed as Record<string, unknown>;
  if (!Array.isArray(objects) || !objects.every((o) => typeof o === "string")) {
    throw new MetaApiError("Spark parse failure: objects must be string[]");
  }
  if (typeof proposedAction !== "string") {
    throw new MetaApiError("Spark parse failure: proposedAction must be a string");
  }
  return {
    objects,
    proposedAction,
    rationale: typeof rationale === "string" ? rationale : "",
    source: "live",
  };
}

export class LiveSparkClient implements SparkClient {
  readonly mode = "live" as const;

  constructor(private readonly apiKey: string) {}

  async reason(input: SparkInput): Promise<SparkClaim> {
    try {
      // Text-only messages: the confirmed spec covers an OpenAI-style messages
      // array, so the frame is not sent. SAM is the frame verifier.
      const res = await metaFetch("/chat/completions", this.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          model: SPARK_MODEL,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                orderId: input.orderId,
                step: input.step,
                transcript: input.transcript ?? "",
              }),
            },
          ],
        }),
      });
      return parseSparkResponse(await res.json());
    } catch (err) {
      // A failed live call is "unavailable", never a mock claim: no objects, and
      // HOLD as the only action it could ever suggest.
      return { objects: [], proposedAction: "HOLD", rationale: "", source: "unavailable", error: describeError(err) };
    }
  }
}

export function getSparkClient(): SparkClient {
  const key = process.env.META_SPARK_API_KEY;
  return shouldUseLive(key) ? new LiveSparkClient(key) : new MockSparkClient();
}
