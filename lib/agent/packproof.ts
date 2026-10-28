// PackProof reasoning: asks Spark what is in the box and what to do next.
// The answer is a proposal only. It reaches the ledger solely through
// guardAction() -> reconcile() in guarded mode.

import { legalActionFor } from "../guard/action-gate";
import { ORDER_1042, STEPS, type LedgerStep } from "../guard/ledger";
import { describeError, metaFetch, MetaApiError, shouldUseLive } from "../meta/http";
import { MockSparkClient, SPARK_MODEL, type SparkClient } from "../meta/spark";
import { redact } from "./redact";
import { AGENT_ACTIONS, type AgentAction, type Observation, type SparkDecision } from "./types";

export type ReasoningContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ReasoningMessage {
  role: "system" | "user";
  content: string | ReasoningContentPart[];
}

export interface ReasoningRequest {
  messages: ReasoningMessage[];
  step: LedgerStep;
  transcript: string;
  visibleText: string;
  /** Fixtures only, so scripted fakes can "see" the frame. Real clients ignore it. */
  frameHint?: Observation["frameHint"];
}

export interface ReasoningClient {
  readonly name: string;
  /** Whether the frame may be sent as an image content part. */
  readonly acceptsImages: boolean;
  /** Returns the model's raw text reply. May throw; decide() turns that into HOLD. */
  complete(request: ReasoningRequest): Promise<string>;
}

export const PACKPROOF_SYSTEM_PROMPT = [
  `You are PackProof, a packing agent for order ${ORDER_1042.id}: ` +
    ORDER_1042.items.map((i) => `${i.qty}x ${i.label}`).join(", ") + ".",
  `The order moves through five steps in order: ${STEPS.join(" -> ")}.`,
  "VERIFY_MUG, VERIFY_NOTEBOOK and VERIFY_CABLE: confirm the item is in the box, then ADVANCE.",
  "SEAL: when all three items are in the box, SEAL. SHIP: when sealed and correct, SHIP.",
  "If anything is wrong or unclear, HOLD.",
  "Return ONLY a JSON object, no prose and no code fences: " +
    '{"claimedObjects": string[] (lowercase labels of the items you see in the box), ' +
    '"proposedAction": "ADVANCE" | "SEAL" | "SHIP" | "HOLD", "rationale": string}.',
].join("\n");

const HOLD_UNPARSEABLE = "unparseable model output";

function hold(rationale: string, usedImage: boolean): SparkDecision {
  return { claimedObjects: [], proposedAction: "HOLD", rationale, usedImage };
}

/** Strict parse: the whole reply (optionally in one ```json fence) must match the schema. */
export function parseDecision(raw: string): Omit<SparkDecision, "usedImage"> | null {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { claimedObjects, proposedAction, rationale } = parsed as Record<string, unknown>;
  if (!Array.isArray(claimedObjects) || !claimedObjects.every((o) => typeof o === "string")) return null;
  if (typeof proposedAction !== "string" || !(AGENT_ACTIONS as readonly string[]).includes(proposedAction)) {
    return null;
  }
  if (typeof rationale !== "string") return null;
  return { claimedObjects, proposedAction: proposedAction as AgentAction, rationale };
}

export function buildMessages(
  observation: Observation,
  ledgerStep: LedgerStep,
  visibleText: string,
  sendImage: boolean,
): ReasoningMessage[] {
  const facts = JSON.stringify({
    orderId: ORDER_1042.id,
    currentStep: ledgerStep,
    transcript: observation.transcript,
    textVisibleInFrame: visibleText,
  });
  const content: ReasoningMessage["content"] =
    sendImage && observation.frameDataUrl
      ? [
          { type: "text", text: facts },
          { type: "image_url", image_url: { url: observation.frameDataUrl } },
        ]
      : facts;
  return [
    { role: "system", content: PACKPROOF_SYSTEM_PROMPT },
    { role: "user", content },
  ];
}

export async function decide(
  observation: Observation,
  ledgerStep: LedgerStep,
  client: ReasoningClient,
  extras: { visibleText?: string } = {},
): Promise<SparkDecision> {
  const visibleText = extras.visibleText ?? "";
  const usedImage = Boolean(observation.frameDataUrl) && client.acceptsImages;
  const request: ReasoningRequest = {
    messages: buildMessages(observation, ledgerStep, visibleText, usedImage),
    step: ledgerStep,
    transcript: observation.transcript,
    visibleText,
    frameHint: observation.frameHint,
  };
  let raw: string;
  try {
    raw = await client.complete(request);
  } catch (err) {
    return hold(redact(`reasoning unavailable: ${describeError(err)}`), usedImage);
  }
  const parsed = parseDecision(raw);
  if (!parsed) return hold(HOLD_UNPARSEABLE, usedImage);
  return { ...parsed, rationale: redact(parsed.rationale), usedImage };
}

/**
 * Muse Spark as a ReasoningClient. With a live key it posts decide()'s
 * messages to the same /chat/completions endpoint and model as lib/meta/spark.
 * Without one it adapts an existing SparkClient (MockSparkClient by default)
 * into the agent's JSON reply shape.
 */
export class SparkReasoningClient implements ReasoningClient {
  readonly name = "spark";
  readonly acceptsImages: boolean;
  private readonly apiKey?: string;
  private readonly fallback: SparkClient;

  constructor(options: { apiKey?: string; acceptsImages?: boolean; fallback?: SparkClient } = {}) {
    this.apiKey = options.apiKey;
    this.acceptsImages = Boolean(options.apiKey) && Boolean(options.acceptsImages);
    this.fallback = options.fallback ?? new MockSparkClient();
  }

  async complete(request: ReasoningRequest): Promise<string> {
    if (!this.apiKey) return this.viaSparkClient(request);
    const res = await metaFetch("/chat/completions", this.apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: SPARK_MODEL, stream: false, messages: request.messages }),
    });
    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new MetaApiError("Spark parse failure: missing choices[0].message.content");
    }
    return content;
  }

  private async viaSparkClient(request: ReasoningRequest): Promise<string> {
    const claim = await this.fallback.reason({
      orderId: ORDER_1042.id,
      step: request.step,
      transcript: request.transcript,
    });
    // SparkClaim.proposedAction is free text (the mock echoes the step name).
    const proposed = (AGENT_ACTIONS as readonly string[]).includes(claim.proposedAction)
      ? claim.proposedAction
      : legalActionFor(request.step);
    return JSON.stringify({ claimedObjects: claim.objects, proposedAction: proposed, rationale: claim.rationale });
  }
}

/** Live Spark only when SAFELABS_USE_MOCKS=false and the key is set (same rule as lib/meta). */
export function getReasoningClient(): ReasoningClient {
  const key = process.env.META_SPARK_API_KEY;
  const acceptsImages = process.env.SAFELABS_SPARK_IMAGES === "true";
  return shouldUseLive(key) ? new SparkReasoningClient({ apiKey: key, acceptsImages }) : new SparkReasoningClient();
}

/** Test/demo double: a scripted function plays the model. */
export class FakeReasoningClient implements ReasoningClient {
  readonly name = "fake";
  readonly calls: ReasoningRequest[] = [];

  constructor(
    private readonly script: (request: ReasoningRequest) => string | Promise<string>,
    readonly acceptsImages = false,
  ) {}

  async complete(request: ReasoningRequest): Promise<string> {
    this.calls.push(request);
    return this.script(request);
  }
}
