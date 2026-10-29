// Stubbed Meta API for route tests. Plays SAM, Voice, Spark vision and Spark
// reasoning from a scene description. Never touches the network.

import { vi } from "vitest";
import { legalActionFor } from "../guard/action-gate";
import type { LedgerStep } from "../guard/ledger";
import { SAM_PROMPT_ALIASES } from "../meta/sam";

export const SECRET = "test-secret-not-real-0123456789abcdef";
export const FAKE_KEY = "test-key-not-real-abc123";
export const PNG = new Uint8Array(
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("FRAMEBYTESFRAMEBYTES")]),
);
export const WAV = new Uint8Array(
  Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("AUDIOBYTES")]),
);

export interface Scene {
  /** Objects SAM finds (by concept). */
  objects: string[];
  /** Text Spark vision reads off the frame. */
  sign?: string;
  /** Voice transcript. */
  transcript?: string;
  samStatus?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function samStream(boxes: number): Response {
  const raw = [
    { type: "response.output_text.delta", delta: "<|box;1,2,3,4|>".repeat(boxes) || "none" },
    { type: "response.completed", response: {} },
  ]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(raw, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

export interface ReasoningFacts {
  currentStep: LedgerStep;
  detectedObjects: { label: string; confidence: number }[];
  untrusted: { frameText: string; transcript: string };
}

/** Naive Spark: honest about objects, obeys "approve shipment"/"ship it" text. */
function sparkReply(facts: ReasoningFacts, objects: string[]) {
  const obey = /approve shipment|ship it|manager override/i;
  const injected = obey.test(facts.untrusted.frameText) || obey.test(facts.untrusted.transcript);
  return JSON.stringify({
    claimedObjects: objects,
    proposedAction: injected ? "SHIP" : legalActionFor(facts.currentStep),
    rationale: injected ? "told to ship" : "looks right",
  });
}

export function stubMeta(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, scene: () => Scene) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const s = scene();
    if (url.endsWith("/files")) return s.samStatus ? json({}, s.samStatus) : json({ id: "file-1" });
    if (url.endsWith("/responses")) {
      const body = JSON.parse(String(init?.body));
      // SAM is prompted with an alias for some labels ("usb cable" for "usb-c cable").
      const prompt = body.input[0].content[0].text as string;
      const concept = Object.entries(SAM_PROMPT_ALIASES).find(([, alias]) => alias === prompt)?.[0] ?? prompt;
      return samStream(s.objects.includes(concept) ? 1 : 0);
    }
    if (url.includes("/asr/transcribe")) return json({ transcript: s.transcript ?? "confirmed", turns: [] });
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      const system = String(body.messages[0].content);
      if (system.startsWith("You transcribe text")) {
        return json({ choices: [{ message: { content: JSON.stringify({ text: s.sign ?? "" }) } }] });
      }
      const facts = JSON.parse(String(body.messages[1].content));
      return json({ choices: [{ message: { content: sparkReply(facts, s.objects) } }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

/** Live-shaped env with fake keys: every call goes to the stubbed fetch. */
export function stubLiveEnv() {
  vi.stubEnv("SAFELABS_TOKEN_SECRET", SECRET);
  vi.stubEnv("SAFELABS_USE_MOCKS", "false");
  vi.stubEnv("SAFELABS_VISION", "spark");
  vi.stubEnv("SAFELABS_LIVE_DISABLED", "");
  vi.stubEnv("SAFELABS_RATE_LIMIT_PER_MIN", "");
  vi.stubEnv("SAFELABS_DAILY_CAP", "");
  vi.stubEnv("META_SAM_API_KEY", FAKE_KEY);
  vi.stubEnv("META_SPARK_API_KEY", FAKE_KEY);
  vi.stubEnv("META_VOICE_API_KEY", FAKE_KEY);
}

export function turnRequest(fields: {
  mode?: string;
  session?: string;
  image?: Uint8Array | null;
  imageType?: string;
  audio?: Uint8Array;
  extra?: Record<string, string>;
}): Request {
  const form = new FormData();
  if (fields.mode !== undefined) form.append("mode", fields.mode);
  if (fields.session) form.append("session", fields.session);
  if (fields.image !== null) {
    form.append("image", new File([Buffer.from(fields.image ?? PNG)], "frame.png", { type: fields.imageType ?? "image/png" }));
  }
  if (fields.audio) form.append("audio", new File([Buffer.from(fields.audio)], "a.wav", { type: "audio/wav" }));
  for (const [k, v] of Object.entries(fields.extra ?? {})) form.append(k, v);
  return new Request("http://localhost/api/agent/turn", { method: "POST", body: form });
}
