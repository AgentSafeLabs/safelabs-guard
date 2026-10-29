"use client";

// Live PackProof agent. Perception comes from the lib/meta mock clients fed
// with the selected ASI-MM case; the guarded decision comes from reconcile().
// The ledger shown here only ever changes to createLedger() output, a state
// built from case.ledgerStep, or reconcile()'s nextState on ALLOW.

import { useEffect, useState } from "react";
import cases from "@/data/asi-mm/cases.json";
import {
  createLedger,
  createLedgerAtStep,
  getExpectedObjects,
  STEPS,
  type LedgerState,
  type LedgerStep,
} from "@/lib/guard/ledger";
import { reconcile } from "@/lib/guard/reconcile";
import { MockSamClient, type SamDetection } from "@/lib/meta/sam";
import { MockSparkClient } from "@/lib/meta/spark";
import { MockVoiceClient } from "@/lib/meta/voice";
import GuardDecision, { type DisplayVerdict } from "./GuardDecision";
import Ledger from "./Ledger";

interface AsiMmCase {
  id: string;
  category: string;
  name: string;
  ledgerStep: string;
  samDetectedObjects: string[];
  sparkClaimedObjects: string[];
  voiceTranscript: string;
  imageText: string;
}

interface Perception {
  sparkObjects: string[];
  samDetections: SamDetection[];
  imageText: string;
  transcript: string;
}

const CASES = cases as AsiMmCase[];

const FEATURED: { id: string; label: string }[] = [
  { id: "A1", label: "Normal PASS" },
  { id: "B2", label: "Missing notebook" },
  { id: "D1", label: "Visual injection (sign)" },
  { id: "E1", label: "Audio injection" },
  { id: "F1", label: "Replayed frame" },
];

// Frame coordinate space used for mock SAM boxes.
const FRAME_W = 640;
const FRAME_H = 360;

const sam = new MockSamClient();
const spark = new MockSparkClient();
const voice = new MockVoiceClient();

function findCase(id: string): AsiMmCase {
  const found = CASES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown case ${id}`);
  return found;
}

function toStep(step: string): LedgerStep {
  if (!(STEPS as readonly string[]).includes(step)) {
    throw new Error(`Unknown ledger step: ${step}`);
  }
  return step as LedgerStep;
}

/** Builds a real, ledger-issued state at the case's step. */
function ledgerAt(step: LedgerStep): LedgerState {
  return createLedgerAtStep(step);
}

async function perceive(c: AsiMmCase): Promise<Perception> {
  const step = toStep(c.ledgerStep);
  const [samResult, claim, heard] = await Promise.all([
    sam.segment({
      frame: `mock://asi-mm/${c.id}`,
      concepts: [...getExpectedObjects(step)],
      mockDetections: c.samDetectedObjects.map((label, i) => ({
        label,
        score: 0.94,
        box: [60 + i * 190, 120, 160, 150],
      })),
      mockImageText: c.imageText,
    }),
    spark.reason({
      orderId: "ORDER-1042",
      step,
      frame: `mock://asi-mm/${c.id}`,
      transcript: c.voiceTranscript,
      mockClaim: {
        objects: c.sparkClaimedObjects,
        proposedAction: step,
        rationale: `Spark claims: ${c.sparkClaimedObjects.join(", ") || "nothing"}`,
      },
    }),
    voice.transcribe({ audio: `mock://asi-mm/${c.id}.wav`, mockTranscript: c.voiceTranscript }),
  ]);
  return {
    sparkObjects: claim.objects,
    samDetections: samResult.detections,
    imageText: samResult.imageText,
    transcript: heard.transcript,
  };
}

/** Unguarded agent: approves whenever Spark says every expected item is there. */
function sparkClaimsStepComplete(step: LedgerStep, claimed: readonly string[]): boolean {
  const said = new Set(claimed.map((o) => o.toLowerCase().trim()));
  return getExpectedObjects(step).every((o) => said.has(o));
}

export default function LiveAgent() {
  const [caseId, setCaseId] = useState("A1");
  const [guardOn, setGuardOn] = useState(true);
  const [perception, setPerception] = useState<Perception | null>(null);
  const [ledger, setLedger] = useState<LedgerState>(() => createLedger());
  const [verdict, setVerdict] = useState<DisplayVerdict>("READY");
  const [reason, setReason] = useState("Pick a scenario and press Verify & Ship.");

  const current = findCase(caseId);

  useEffect(() => {
    let cancelled = false;
    setPerception(null);
    setLedger(ledgerAt(toStep(current.ledgerStep)));
    setVerdict("READY");
    setReason("Pick a scenario and press Verify & Ship.");
    perceive(current).then((p) => {
      if (!cancelled) setPerception(p);
    });
    return () => {
      cancelled = true;
    };
  }, [current]);

  function verify() {
    if (!perception) return;
    const step = toStep(current.ledgerStep);

    if (!guardOn) {
      if (sparkClaimsStepComplete(step, perception.sparkObjects)) {
        setVerdict("ALLOW");
        setReason("Agent approved: Spark said every item is in the box.");
      } else {
        setVerdict("HOLD");
        setReason("Agent waiting: Spark itself did not claim the step complete.");
      }
      return;
    }

    const result = reconcile({
      ledgerState: ledgerAt(step),
      sparkClaimedObjects: perception.sparkObjects,
      samDetectedObjects: perception.samDetections.map((d) => d.label),
      voiceTranscript: perception.transcript,
      imageText: perception.imageText,
    });
    setVerdict(result.decision);
    setReason(result.reason);
    if (result.decision === "ALLOW" && result.nextState) setLedger(result.nextState);
  }

  function reset() {
    setLedger(createLedger());
    setVerdict("READY");
    setReason("Ledger reset to the first step.");
  }

  function toggleGuard() {
    setGuardOn((on) => !on);
    setLedger(ledgerAt(toStep(current.ledgerStep)));
    setVerdict("READY");
    setReason("Pick a scenario and press Verify & Ship.");
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Scenario</div>
          <div className="flex flex-wrap gap-2">
            {FEATURED.map((f) => (
              <button
                key={f.id}
                onClick={() => setCaseId(f.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  caseId === f.id
                    ? "border-white bg-white text-zinc-950"
                    : "border-zinc-700 text-zinc-200 hover:border-zinc-400"
                }`}
              >
                <span className="font-mono">{f.id}</span> · {f.label}
              </button>
            ))}
            <select
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              aria-label="All ASI-MM cases"
            >
              {CASES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={toggleGuard}
          role="switch"
          aria-checked={guardOn}
          className={`flex items-center gap-3 rounded-full border-2 px-4 py-2 font-bold transition ${
            guardOn
              ? "border-emerald-400 bg-emerald-950 text-emerald-200"
              : "border-amber-400 bg-amber-950 text-amber-200"
          }`}
        >
          <span
            className={`relative h-6 w-11 rounded-full transition ${guardOn ? "bg-emerald-500" : "bg-zinc-600"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                guardOn ? "left-[22px]" : "left-0.5"
              }`}
            />
          </span>
          Guard {guardOn ? "ON" : "OFF"}
        </button>
      </div>

      {!guardOn && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-950 px-4 py-3 text-center font-bold text-amber-200">
          ⚠ Unguarded: agent trusts Spark&apos;s claim
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Camera frame + actions */}
        <div className="space-y-4 lg:col-span-3">
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-white">
                <span className="font-mono text-zinc-400">{current.id}</span> {current.name}
              </h2>
              <span className="shrink-0 font-mono text-xs text-zinc-500">{current.ledgerStep}</span>
            </div>

            <div
              className="relative w-full overflow-hidden rounded-2xl border border-zinc-700 bg-gradient-to-br from-zinc-800 to-zinc-950"
              style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}` }}
            >
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-zinc-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> CAM 1 · PACK STATION
              </div>
              <div className="absolute right-3 top-3 rounded bg-black/60 px-2 py-1 font-mono text-xs text-sky-300">
                SAM 3.1 (mock)
              </div>

              {perception?.samDetections.map((d, i) => {
                const [x, y, w, h] = d.box;
                return (
                  <div
                    key={`${d.label}-${i}`}
                    className="absolute rounded-md border-2 border-sky-400 bg-sky-400/10"
                    style={{
                      left: `${(x / FRAME_W) * 100}%`,
                      top: `${(y / FRAME_H) * 100}%`,
                      width: `${(w / FRAME_W) * 100}%`,
                      height: `${(h / FRAME_H) * 100}%`,
                    }}
                  >
                    <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-sky-500 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                      {d.label} {d.score.toFixed(2)}
                    </span>
                  </div>
                );
              })}

              {perception && perception.samDetections.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-sm text-zinc-500">
                  SAM: no objects detected
                </div>
              )}

              {perception?.imageText && (
                <div className="absolute bottom-14 right-4 max-w-[45%] rotate-[-2deg] rounded border-2 border-zinc-900 bg-yellow-200 px-3 py-1.5 text-center font-mono text-sm font-black uppercase text-zinc-900 shadow-lg">
                  {perception.imageText}
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 font-mono text-xs text-teal-200">
                🎙 {perception ? perception.transcript || "(silence)" : "listening…"}
              </div>

              {!perception && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
                  Running perception…
                </div>
              )}
            </div>

            {perception && (
              <div className="mt-2 rounded-lg border border-violet-800 bg-violet-950/60 px-3 py-2 text-sm text-violet-100">
                <span className="font-bold">Spark claims in frame:</span>{" "}
                {perception.sparkObjects.join(", ") || "(nothing)"}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={verify}
              disabled={!perception}
              className="flex-1 rounded-xl bg-white px-6 py-4 text-xl font-black text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-40"
            >
              Verify &amp; Ship
            </button>
            <button
              onClick={reset}
              className="rounded-xl border border-zinc-600 px-6 py-4 text-lg font-bold text-zinc-200 transition hover:border-zinc-300"
            >
              Reset
            </button>
          </div>

          <GuardDecision
            verdict={verdict}
            reason={reason}
            guardOn={guardOn}
            sources={
              perception && {
                sparkClaim: perception.sparkObjects,
                samDetected: perception.samDetections.map((d) => d.label),
                voiceTranscript: perception.transcript,
                imageText: perception.imageText,
              }
            }
          />
        </div>

        {/* Ledger */}
        <div className="lg:col-span-2">
          <Ledger state={ledger} blocked={guardOn && verdict === "BLOCK"} />
          {!guardOn && verdict === "ALLOW" && (
            <p className="mt-3 rounded-xl border border-amber-500 bg-amber-950 px-4 py-3 text-sm font-semibold text-amber-200">
              The unguarded agent acted without consulting the ledger. Nothing here was verified.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
