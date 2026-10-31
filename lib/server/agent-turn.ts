// POST /api/agent/turn handler: one guarded or unguarded PackProof turn on a
// real uploaded frame (and optional WAV). The server derives perception,
// transcript and ledger position itself; the client sends only mode, a signed
// session token and media. The decision comes from runTurn() -> guardAction()
// -> reconcile(). Fails closed: errors become BLOCK or a 4xx/5xx, never ALLOW.
//
// The response also carries, for display only:
//   perceptionDetail  a fixed, non-secret label per unavailable source
//                     (lib/agent/perception-detail.ts)
//   securityEvents    injection scan of image text + transcript on every turn;
//                     in unguarded mode it runs after the action is fixed and is
//                     marked shadow. Neither ever changes a decision.

import { ORDER_1042, getExpectedObjects, type LedgerStep } from "../guard/ledger";
import { shouldUseLive } from "../meta/http";
import { getSamClient, MockSamClient, type SamClient, type SamInput, type SamResult } from "../meta/sam";
import type { SparkClaim, SparkClient, SparkInput } from "../meta/spark";
import { getVoiceClient, MockVoiceClient } from "../meta/voice";
import { isShipAllowance, signApproval } from "../agent/approval";
import { isTimeout, safeDetail, type PerceptionDetail } from "../agent/perception-detail";
import { scanForInjection, type ScanInput, type SecurityEvent } from "../agent/security-events";
import { getReasoningClient, sparkFailureDetail, SparkReasoningClient, sparkTimeoutFor, type SparkRetryPolicy } from "../agent/packproof";
import { redact } from "../agent/redact";
import { runTurn } from "../agent/run";
import { freshSessionState, sessionFromState, signSession, verifySession, type SessionState } from "../agent/session-token";
import { TokenConfigError } from "../agent/signing";
import type { AgentMode, Observation, TurnRecord } from "../agent/types";
import { MockVisionClient, selectVision, type ImageUnderstanding, type VisionExtract } from "../agent/vision";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_TURN_BODY_BYTES } from "./limits";
import { checkRate, clientIp, consumeLiveBudget, isLiveDisabled } from "./rate-limit";
import { inspectImage, isValidWav, readMultipart, sniffImage } from "./request-guard";
import { TurnTimings } from "./turn-timing";

export { sniffImage };
export const MAX_UPLOAD_BYTES = MAX_IMAGE_BYTES;
/** Unordered objects SAM is also asked about on every turn. */
export const ROUTE_DISTRACTORS = ["banana", "laptop"] as const;
/** No Spark retry once a turn has run this long: the route's maxDuration is 60 s. */
export const SPARK_RETRY_DEADLINE_MS = 35_000;
/** The route's maxDuration, and the part of it kept back for building the response. */
export const TURN_BUDGET_MS = 60_000;
export const TURN_RESERVE_MS = 4_000;

export type SourceLabel = "live" | "mock" | "unavailable";
export type SourceName = "sam" | "vision" | "voice" | "spark";

const FAILED_CLOSED: PerceptionDetail = "not consulted: perception failed closed";

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}, headers?: HeadersInit): Response {
  return Response.json({ error, ...extra }, { status, headers });
}

function dataUri(type: string, bytes: Uint8Array): string {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * Asks SAM about the ledger's expected concepts plus ROUTE_DISTRACTORS, one
 * concept per call, in parallel. Any failed or non-live call marks the whole
 * result non-live with an error, so guarded mode fails closed.
 */
class ParallelConceptSam implements SamClient {
  readonly mode: "live" | "mock";
  lastSource: SourceLabel = "unavailable";
  /** Why the last call was unavailable; null when it was not. */
  detail: PerceptionDetail | null = FAILED_CLOSED;

  constructor(
    private readonly base: SamClient,
    private readonly concepts: readonly string[],
  ) {
    this.mode = base.mode;
  }

  async segment(input: SamInput): Promise<SamResult> {
    const concepts = [...this.concepts];
    if (this.base.mode === "mock") {
      // Mock detections come from the server-built frame hint; one call is enough.
      const result = await this.base.segment({ ...input, concepts });
      this.lastSource = result.error ? "unavailable" : "mock";
      this.detail = result.error ? (isTimeout(result.error) ? "sam timeout" : "sam error") : null;
      return result;
    }
    const results = await Promise.all(
      concepts.map((concept) =>
        this.base.segment({ frame: input.frame, concepts: [concept] }).catch(
          (): SamResult => ({ detections: [], imageText: "", source: "unavailable", error: "SAM call failed" }),
        ),
      ),
    );
    const failed = results.find((r) => r.error || r.source !== "live");
    this.lastSource = failed ? "unavailable" : "live";
    this.detail = !failed
      ? null
      : this.base.mode !== "live"
        ? "sam not configured"
        : isTimeout(failed.error)
          ? "sam timeout"
          : failed.error
            ? "sam error"
            : "sam not live";
    return {
      // Only live results count (a failed call carries no detections anyway).
      detections: results.flatMap((r, i) => (r.error || r.source !== "live" ? [] : r.detections.filter((d) => d.label === concepts[i]))),
      imageText: "",
      source: failed ? "unavailable" : "live",
      // The fixed label, not the upstream text: it ends up in the guard's block reason.
      error: failed ? this.detail ?? "sam error" : undefined,
    };
  }
}

/** Records the extract() outcome for the sources block and the injection scan. */
class TrackedVision implements ImageUnderstanding {
  readonly name: ImageUnderstanding["name"];
  ok = false;
  /** Raw visible text when ok (scanned for securityEvents, never returned whole). */
  text = "";
  detail: PerceptionDetail | null = FAILED_CLOSED;

  constructor(private readonly base: ImageUnderstanding) {
    this.name = base.name;
  }

  available(): boolean {
    return this.base.available();
  }

  async extract(frame: Observation): Promise<VisionExtract> {
    let result: VisionExtract;
    try {
      result = await this.base.extract(frame);
    } catch {
      result = { visibleText: "", ok: false };
    }
    this.ok = result.ok;
    this.text = result.ok ? result.visibleText : "";
    this.detail = result.ok ? null : this.failureDetail(frame, result);
    return result;
  }

  private failureDetail(frame: Observation, result: VisionExtract): PerceptionDetail {
    if (!frame.frameDataUrl) return "no frame sent";
    const known = safeDetail(result.perceptionDetail);
    if (known) return known;
    // Mock vision cannot read a real frame; an unavailable client has no key or package.
    if (this.name === "mock" || !this.available()) return "vision not configured";
    return "vision error";
  }
}

/** Mock Spark for explicit mock mode: claims the step's expected objects. */
class StepMockSpark implements SparkClient {
  readonly mode = "mock" as const;

  async reason(input: SparkInput): Promise<SparkClaim> {
    return {
      objects: [...getExpectedObjects(input.step as LedgerStep)],
      proposedAction: input.step,
      rationale: "Mock: expected items for this step.",
      source: "mock",
    };
  }
}

function blockedRecord(
  turn: number,
  mode: AgentMode,
  step: LedgerStep,
  observation: Observation,
  reason: string,
  shipped: boolean,
): TurnRecord {
  return {
    turn,
    mode,
    step,
    observation: {
      hasFrame: Boolean(observation.frameDataUrl),
      frameMimeType: observation.frameDataUrl ? /^data:([^;,]+)/.exec(observation.frameDataUrl)?.[1] ?? null : null,
      hasFrameHint: false,
      transcript: "",
    },
    sparkDecision: { claimedObjects: [], proposedAction: "HOLD", rationale: "not consulted: perception failed closed", usedImage: false },
    perception: { samObjects: [], agentSaw: [], imageText: "", imageTextSource: "none", transcript: "" },
    guard: { decision: "BLOCK", reason },
    executed: null,
    shipped,
    ledgerStepAfter: step,
  };
}

export interface TurnDeps {
  /** Injection scan for securityEvents. Injectable so tests can prove it never changes a decision. */
  scan: (input: ScanInput, shadow: boolean) => SecurityEvent[];
}

const DEFAULT_DEPS: TurnDeps = { scan: scanForInjection };

export async function handleTurn(request: Request, deps: TurnDeps = DEFAULT_DEPS): Promise<Response> {
  const startedAt = Date.now();
  const timings = new TurnTimings();
  const rate = checkRate(clientIp(request));
  if (!rate.allowed) {
    return jsonError(429, "Too many requests", {}, { "Retry-After": String(rate.retryAfter) });
  }

  // 415 for another content type, 413 over the body cap, 400 if unparseable.
  const parsed = await readMultipart(request, MAX_TURN_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const form = parsed.form;

  const modeRaw = form.get("mode");
  if (modeRaw !== "guarded" && modeRaw !== "unguarded") {
    return jsonError(400, 'mode must be "guarded" or "unguarded"');
  }
  const mode: AgentMode = modeRaw;

  try {
    // Session: verified token, or a fresh one at the first step.
    const tokenField = form.get("session");
    let state: SessionState;
    if (tokenField === null || tokenField === "") {
      state = freshSessionState(mode);
    } else {
      const verified = verifySession(tokenField);
      if (!verified.ok) return jsonError(401, "Invalid session", { reason: verified.reason });
      if (verified.payload.mode !== mode) {
        return jsonError(400, "Session mode mismatch", { reason: `session was started in ${verified.payload.mode} mode` });
      }
      state = verified.payload;
    }

    // Media.
    const imageField = form.get("image");
    let frameDataUrl: string | undefined;
    if (imageField !== null) {
      if (!(imageField instanceof File) || imageField.size === 0) return jsonError(400, "image must be a non-empty file");
      if (imageField.size > MAX_IMAGE_BYTES) return jsonError(400, "image is larger than 8 MB");
      if (!imageField.type.startsWith("image/")) return jsonError(400, "image must be an image/* file");
      const imageBytes = new Uint8Array(await imageField.arrayBuffer());
      const image = inspectImage(imageBytes);
      if (!image.ok) return jsonError(400, image.error);
      frameDataUrl = dataUri(image.type, imageBytes);
    }
    const audioField = form.get("audio");
    let audio: string | undefined;
    if (audioField !== null) {
      if (!(audioField instanceof File) || audioField.size === 0) return jsonError(400, "audio must be a non-empty file");
      if (audioField.size > MAX_AUDIO_BYTES) return jsonError(400, "audio is larger than 1 MB");
      const audioBytes = new Uint8Array(await audioField.arrayBuffer());
      if (!isValidWav(audioBytes)) return jsonError(400, "audio must be a WAV file");
      audio = dataUri("audio/wav", audioBytes);
    }

    const killed = isLiveDisabled();
    const mockMode = killed || process.env.SAFELABS_USE_MOCKS === "true";
    const session = sessionFromState(state);
    const step = session.ledger.step;
    const expected = getExpectedObjects(step);
    const concepts = [...expected, ...ROUTE_DISTRACTORS.filter((d) => !expected.includes(d))];
    const turnNumber = state.turn + 1;

    const baseSam = mockMode ? new MockSamClient() : getSamClient();
    const voiceClient = audio ? (mockMode ? new MockVoiceClient() : getVoiceClient()) : null;
    const vision = new TrackedVision(mockMode ? new MockVisionClient() : selectVision(process.env));
    const sparkLive = !mockMode && shouldUseLive(process.env.META_SPARK_API_KEY);
    const reasoning = mockMode ? new SparkReasoningClient({ fallback: new StepMockSpark() }) : getReasoningClient();

    // Daily budget for live calls (SAM: upload + response per concept).
    const liveCalls =
      (baseSam.mode === "live" && frameDataUrl ? concepts.length * 2 : 0) +
      (voiceClient?.mode === "live" ? 1 : 0) +
      (vision.name === "spark" && vision.available() ? 1 : 0) +
      (sparkLive ? 1 : 0);
    if (liveCalls > 0 && !consumeLiveBudget(liveCalls)) {
      return jsonError(429, "Daily live budget exhausted");
    }

    // Voice: a live transcript, or the mock one only in explicit mock mode.
    let transcript = "";
    let voiceSource: SourceLabel = "unavailable";
    let voiceDetail: PerceptionDetail | null = "voice not sent";
    if (voiceClient && audio) {
      const heard = await timings.time("voice", () => voiceClient.transcribe({ audio })).catch(() => null);
      if (heard && heard.source === "live" && !heard.error) {
        transcript = heard.transcript;
        voiceSource = "live";
        voiceDetail = null;
      } else if (heard && mockMode) {
        transcript = heard.transcript;
        voiceSource = "mock";
        voiceDetail = null;
      } else {
        voiceDetail =
          safeDetail(heard?.perceptionDetail) ??
          (heard && !heard.error && voiceClient.mode !== "live"
            ? "voice not configured"
            : isTimeout(heard?.error)
              ? "voice timeout"
              : "voice error");
      }
    }

    const observation: Observation = {
      frameDataUrl,
      transcript,
      // Explicit mock mode only: mock perception assumes the frame shows the expected items.
      frameHint: mockMode && frameDataUrl ? { objects: [...expected], imageText: "" } : undefined,
    };

    const sam = new ParallelConceptSam(baseSam, concepts);
    let record: TurnRecord;
    let sparkUnavailable: PerceptionDetail | null = null;
    if (mode === "guarded" && audio && voiceSource === "unavailable") {
      record = blockedRecord(turnNumber, mode, step, observation, "voice unavailable", session.shipped);
    } else {
      // One retry of a failed Spark call, in both modes. It spends one more
      // unit of the daily budget, and is skipped late in the turn or when the
      // budget is gone: the turn then fails closed (HOLD) as before.
      const sparkRetry: SparkRetryPolicy | undefined = sparkLive
        ? {
            allow: () => Date.now() - startedAt < SPARK_RETRY_DEADLINE_MS && consumeLiveBudget(1),
            // Longer second try, and neither call may outlive the route's maxDuration.
            timeoutMs: (attempt) => sparkTimeoutFor(attempt, TURN_BUDGET_MS - TURN_RESERVE_MS - (Date.now() - startedAt)),
          }
        : undefined;
      record = await runTurn(session, observation, {
        mode,
        sam,
        vision,
        reasoning,
        requireLive: !mockMode,
        concepts,
        sparkRetry,
        timing: timings,
      });
      record = { ...record, turn: turnNumber };
      if (record.sparkDecision.rationale.startsWith("reasoning unavailable")) {
        // decide() already wrote a fixed label; rebuild it from the failure class
        // so nothing but an allow-listed string is ever returned.
        sparkUnavailable = sparkFailureDetail(record.sparkDecision.failure ?? "error");
        record = { ...record, sparkDecision: { ...record.sparkDecision, rationale: `reasoning unavailable: ${sparkUnavailable}` } };
      }
    }

    let approval: string | undefined;
    const allowance = {
      mode,
      step: record.step,
      proposedAction: record.sparkDecision.proposedAction,
      decision: record.guard?.decision,
    };
    if (record.executed === "SHIP" && isShipAllowance(allowance)) {
      approval = signApproval(ORDER_1042.id, allowance);
    }

    const sparkSource: SourceLabel = record.sparkDecision.rationale.startsWith("not consulted")
      ? "unavailable"
      : record.sparkDecision.rationale.startsWith("reasoning unavailable")
        ? "unavailable"
        : sparkLive
          ? "live"
          : "mock";
    const sources: Record<SourceName, SourceLabel> = killed
      ? { sam: "mock", voice: "mock", vision: "mock", spark: "mock" }
      : {
          sam: sam.lastSource,
          voice: voiceSource,
          vision: vision.ok ? (vision.name === "mock" ? "mock" : "live") : "unavailable",
          spark: sparkSource,
        };

    // One fixed label per unavailable source. Voice also says when no clip was sent.
    const perceptionDetail: Partial<Record<SourceName, PerceptionDetail>> = {};
    if (sources.sam === "unavailable") perceptionDetail.sam = sam.detail ?? "sam error";
    if (sources.vision === "unavailable") perceptionDetail.vision = vision.detail ?? "vision error";
    if (sources.voice === "unavailable" || !audio) perceptionDetail.voice = voiceDetail ?? "voice error";
    if (sources.spark === "unavailable") {
      perceptionDetail.spark = record.sparkDecision.rationale.startsWith("not consulted")
        ? "spark not consulted: perception failed closed"
        : sparkUnavailable ?? "spark error";
    }

    // Display only, after the decision and action are final. Guarded: every
    // turn, HOLD included. Unguarded: a shadow of what the guard would flag.
    const securityEvents = deps.scan({ imageText: vision.text, transcript }, mode === "unguarded");

    const token = signSession({
      orderId: ORDER_1042.id,
      mode,
      step: session.ledger.step,
      sealed: session.sealed,
      shipped: session.shipped,
      turn: turnNumber,
    });

    console.info(timings.logLine(mode, turnNumber));
    return Response.json(
      {
        turn: record,
        session: token,
        ledger: { step: session.ledger.step, stepIndex: session.ledger.stepIndex, status: session.ledger.status },
        shipped: session.shipped,
        sources,
        perceptionDetail,
        securityEvents,
        ...(approval ? { approval } : {}),
      },
      { headers: { "Server-Timing": timings.serverTiming() } },
    );
  } catch (err) {
    if (err instanceof TokenConfigError) return jsonError(503, "Session signing is not configured");
    console.error(`agent turn failed: ${err instanceof Error ? err.name : "unknown"}: ${redact(err instanceof Error ? err.message : "")}`);
    return jsonError(500, "Agent turn failed", { reason: redact(err instanceof Error ? err.name : "unknown") });
  }
}
