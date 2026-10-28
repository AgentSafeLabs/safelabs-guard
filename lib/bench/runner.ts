// Tier-2 benchmark runner: every manifest case through three agents, using
// the real lib/agent runTurn (with the perception report) and the real guard.
//   guarded             PackProof prompt + guardAction()/reconcile()
//   unguarded-prompted  the same agent and prompt, no guard
//   unguarded-naive     the same Spark client with bench/agents/naive.ts's
//                       prompt, no guard (a deliberately weaker baseline)
// Perception per case is resolved once and shared by all three agents:
// SAM and Voice through the recorder, OCR locally (not recorded, but its text
// is kept in the results). The scripted tier-1 benchmark in lib/benchmark is
// separate and unchanged.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAIVE_AGENT_LABEL } from "../../bench/agents/naive";
import { legalActionFor } from "../guard/action-gate";
import { detectInjectionInSources } from "../guard/injections";
import { createLedgerAtStep, getExpectedObjects } from "../guard/ledger";
import { SAM_MODEL, type SamClient } from "../meta/sam";
import { SPARK_MODEL } from "../meta/spark";
import { VOICE_MODEL, type VoiceClient } from "../meta/voice";
import type { SparkReasoningClient } from "../agent/packproof";
import { redact } from "../agent/redact";
import { createSession, runTurn } from "../agent/run";
import type { AgentMode, Observation } from "../agent/types";
import type { ImageUnderstanding } from "../agent/vision";
import { ROUTE_DISTRACTORS } from "../server/agent-turn";
import type { BenchCase, Manifest } from "./manifest";
import { AGENT_IDS, summarizeAll, type AgentId, type AgentOutcome, type CaseResult, type Summaries } from "./metrics";
import { sha256Hex, type Recorder } from "./recorder";
import { detectObjects, RecordedReasoningClient, samKey, transcribe, voiceKey, type Media } from "./services";

export const AGENT_LABELS: Readonly<Record<AgentId, string>> = {
  guarded: "guarded (PackProof prompt + guard)",
  "unguarded-prompted": "unguarded-prompted (same agent and prompt, no guard)",
  "unguarded-naive": NAIVE_AGENT_LABEL,
};

export interface OcrResult {
  ok: boolean;
  text: string;
}

export type SparkLike = Pick<SparkReasoningClient, "messagesFor" | "complete">;

export interface RunnerDeps {
  recorder: Recorder;
  /** bench/ directory; media paths in the manifest are relative to it. */
  benchDir: string;
  /** Local OCR of a frame. Not recorded. */
  ocr: (image: Media) => Promise<OcrResult>;
  liveSam: () => SamClient;
  liveVoice: () => VoiceClient;
  /** The PackProof prompt client and the naive-prompt client (same Spark client, systemPrompt override). */
  spark: { prompted: SparkLike; naive: SparkLike };
}

export interface BenchResults {
  benchmark: string;
  schema: 1;
  manifestSha256: string;
  models: { sam: string; voice: string; spark: string };
  agents: Record<AgentId, string>;
  cases: CaseResult[];
  summary: Summaries;
}

/** The concepts SAM is asked about: the same list the live route uses. */
export function conceptsForStep(step: BenchCase["step"]): string[] {
  const expected = getExpectedObjects(step);
  return [...expected, ...ROUTE_DISTRACTORS.filter((d) => !expected.includes(d))];
}

export function loadMedia(benchDir: string, path: string): Media {
  const bytes = new Uint8Array(readFileSync(join(benchDir, path)));
  const lower = path.toLowerCase();
  const type = lower.endsWith(".wav")
    ? "audio/wav"
    : lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
  return { path, bytes, sha256: sha256Hex(bytes), dataUrl: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` };
}

function outcomeOf(record: Awaited<ReturnType<typeof runTurn>>, session: ReturnType<typeof createSession>): AgentOutcome {
  return {
    proposed: record.sparkDecision.proposedAction,
    claimed: record.sparkDecision.claimedObjects.slice(0, 20).map((o) => redact(o).slice(0, 60)),
    rationale: redact(record.sparkDecision.rationale).slice(0, 300),
    executed: record.executed,
    guard: record.guard,
    shipped: session.shipped,
    ledgerAfter: record.ledgerStepAfter,
  };
}

export class BenchRunner {
  private readonly media = new Map<string, Media>();
  private readonly ocrCache = new Map<string, OcrResult>();
  readonly prompted: RecordedReasoningClient;
  readonly naive: RecordedReasoningClient;

  constructor(private readonly deps: RunnerDeps) {
    this.prompted = new RecordedReasoningClient(deps.recorder, deps.spark.prompted);
    this.naive = new RecordedReasoningClient(deps.recorder, deps.spark.naive);
  }

  private load(path: string): Media {
    let m = this.media.get(path);
    if (!m) {
      m = loadMedia(this.deps.benchDir, path);
      this.media.set(path, m);
    }
    return m;
  }

  private async ocr(image: Media): Promise<OcrResult> {
    let r = this.ocrCache.get(image.sha256);
    if (!r) {
      r = await this.deps.ocr(image);
      this.ocrCache.set(image.sha256, r);
    }
    return r;
  }

  async runCase(c: BenchCase): Promise<CaseResult> {
    const { recorder } = this.deps;
    const image = this.load(c.image);
    const audio = c.audio ? this.load(c.audio) : null;
    const concepts = conceptsForStep(c.step);

    // Perception, once per case. Hard errors (replay miss, live failure) propagate.
    const sam = await detectObjects(recorder, image, concepts, this.deps.liveSam);
    const ocr = await this.ocr(image);
    const voice = audio ? await transcribe(recorder, audio, this.deps.liveVoice) : null;
    const transcript = voice?.ok ? voice.transcript : "";

    const staticSam: SamClient = { mode: "live", segment: async () => sam };
    const vision: ImageUnderstanding = {
      name: "ocr",
      available: () => true,
      extract: async () =>
        ocr.ok ? { visibleText: ocr.text, ok: true } : { visibleText: "", ok: false, perceptionDetail: "ocr error" },
    };
    const observation: Observation = { frameDataUrl: image.dataUrl, transcript };

    const agents = {} as Record<AgentId, AgentOutcome>;
    for (const agent of AGENT_IDS) {
      const mode: AgentMode = agent === "guarded" ? "guarded" : "unguarded";
      const reasoning = agent === "unguarded-naive" ? this.naive : this.prompted;
      const session = createSession(createLedgerAtStep(c.step));
      if (mode === "guarded" && voice && !voice.ok) {
        // As the live route does: a clip was sent but no usable transcript came back.
        agents[agent] = {
          proposed: "HOLD",
          claimed: [],
          rationale: "not consulted: perception failed closed",
          executed: null,
          guard: { decision: "BLOCK", reason: "voice unavailable" },
          shipped: false,
          ledgerAfter: c.step,
        };
        continue;
      }
      const record = await runTurn(session, observation, {
        mode,
        sam: staticSam,
        vision,
        reasoning,
        requireLive: true,
        concepts,
      });
      recorder.assertHealthy();
      agents[agent] = outcomeOf(record, session);
    }

    const scan = detectInjectionInSources(ocr.text, transcript);
    return {
      id: c.id,
      category: c.category,
      split: c.split,
      real: c.real === true,
      step: c.step,
      expected: c.expected,
      injection: c.injection,
      legalAction: legalActionFor(c.step),
      perception: {
        samDetected: sam.detections.map((d) => d.label),
        ocrOk: ocr.ok,
        ocrText: redact(ocr.text),
        voiceOk: voice ? voice.ok : null,
        transcript: redact(transcript),
      },
      detector: { flagged: scan.detected, source: scan.source ?? null, matched: scan.matched ?? null },
      agents,
    };
  }

  async run(manifest: Manifest, manifestText: string): Promise<BenchResults> {
    const cases: CaseResult[] = [];
    for (const c of manifest.cases) cases.push(await this.runCase(c));
    return {
      benchmark: "safelabs-guard tier 2: media-backed PackProof benchmark",
      schema: 1,
      manifestSha256: sha256Hex(manifestText),
      models: { sam: SAM_MODEL, voice: VOICE_MODEL, spark: SPARK_MODEL },
      agents: { ...AGENT_LABELS },
      cases,
      summary: summarizeAll(cases),
    };
  }
}

export interface LiveCallEstimate {
  /** HTTP requests: one upload per image plus one per concept without a recording. */
  sam: number;
  voice: number;
  /** Upper bound: two reasoning prompts per case (PackProof prompt, naive prompt). */
  spark: number;
  total: number;
}

/**
 * Live calls a record run would make, given the recordings already on disk.
 * Follows the runner's order: SAM is asked once per case for the concepts no
 * recording (or earlier case) covers. Makes no calls.
 */
export function estimateLiveCalls(manifest: Manifest, recorder: Recorder, benchDir: string): LiveCallEstimate {
  const covered = new Set<string>();
  const audios = new Set<string>();
  let sam = 0;
  for (const c of manifest.cases) {
    const image = loadMedia(benchDir, c.image);
    let fresh = 0;
    for (const concept of conceptsForStep(c.step)) {
      const id = `${image.sha256}:${concept}`;
      if (covered.has(id)) continue;
      covered.add(id);
      if (!recorder.has(samKey(image, concept))) fresh += 1;
    }
    if (fresh) sam += 1 + fresh;
    if (c.audio) {
      const audio = loadMedia(benchDir, c.audio);
      if (!recorder.has(voiceKey(audio))) audios.add(audio.sha256);
    }
  }
  const spark = manifest.cases.length * 2;
  return { sam, voice: audios.size, spark, total: sam + audios.size + spark };
}
