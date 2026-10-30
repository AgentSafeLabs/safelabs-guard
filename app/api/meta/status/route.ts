// Server-only spike: reports whether Spark / SAM / Voice run live or mock.
// GET /api/meta/status          -> configured mode per client (no API calls)
// GET /api/meta/status?probe=1  -> also makes one tiny call per client and
//                                   reports the source actually used + error,
//                                   ONLY with header x-safelabs-admin equal to
//                                   SAFELABS_ADMIN_TOKEN. Order: kill switch (503),
//                                   per-IP limit (429), token unset (404), wrong or
//                                   missing token (403), at most 3 probes per hour
//                                   per instance (429), daily budget (429). No Meta
//                                   call is made before all of those pass.
// Never returns keys, values or prefixes, only whether each key is set.

import { NextResponse } from "next/server";
import { adminState, consumeProbeSlot } from "../../../../lib/server/admin";
import { checkRate, clientIp, consumeLiveBudget, isLiveDisabled } from "../../../../lib/server/rate-limit";
import { getSamClient } from "../../../../lib/meta/sam";
import { getSparkClient } from "../../../../lib/meta/spark";
import { getVoiceClient } from "../../../../lib/meta/voice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 1x1 transparent PNG: SAM should return 0 box records (not verified).
const PROBE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** 0.5s of silence as mono 16-bit PCM WAV at 16 kHz (the format Voice requires). */
function silentWavDataUri(): string {
  const sampleRate = 16_000;
  const samples = sampleRate / 2;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  return `data:audio/wav;base64,${buf.toString("base64")}`;
}

function retry(status: number, error: string, retryAfter: number): Response {
  return NextResponse.json({ error }, { status, headers: { "Retry-After": String(retryAfter) } });
}

/** Probe errors are shown as one of two fixed words, never as upstream text. */
function probeError(error: string | undefined): string | null {
  if (!error) return null;
  return /timed? ?out|timeout/i.test(error) ? "timeout" : "error";
}

export async function GET(request: Request) {
  const wantsProbe = new URL(request.url).searchParams.get("probe") === "1";
  if (wantsProbe) {
    if (isLiveDisabled()) return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    const rate = checkRate(clientIp(request));
    if (!rate.allowed) return retry(429, "Too many requests", rate.retryAfter);
    const admin = adminState(request);
    if (admin === "disabled") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (admin === "denied") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const slot = consumeProbeSlot();
    if (!slot.allowed) return retry(429, "Too many probes", slot.retryAfter);
  }

  const spark = getSparkClient();
  const sam = getSamClient();
  const voice = getVoiceClient();

  const status = {
    useMocks: process.env.SAFELABS_USE_MOCKS ?? null,
    spark: { mode: spark.mode, keySet: Boolean(process.env.META_SPARK_API_KEY) },
    sam: { mode: sam.mode, keySet: Boolean(process.env.META_SAM_API_KEY) },
    voice: { mode: voice.mode, keySet: Boolean(process.env.META_VOICE_API_KEY) },
  };

  if (!wantsProbe) return NextResponse.json(status);

  const liveClients = [spark, sam, voice].filter((c) => c.mode === "live").length;
  if (liveClients > 0 && !consumeLiveBudget(liveClients)) {
    return retry(429, "Daily live budget exhausted", 3600);
  }

  const [sparkOut, samOut, voiceOut] = await Promise.all([
    spark.reason({ orderId: "ORDER-1042", step: "VERIFY_MUG" }),
    sam.segment({ frame: PROBE_PNG, concepts: ["cardboard box"] }),
    voice.transcribe({ audio: silentWavDataUri() }),
  ]);

  return NextResponse.json({
    ...status,
    probe: {
      spark: { source: sparkOut.source, error: probeError(sparkOut.error), objects: sparkOut.objects },
      sam: { source: samOut.source, error: probeError(samOut.error), verified: samOut.detections.length > 0 },
      voice: { source: voiceOut.source, error: probeError(voiceOut.error), transcript: voiceOut.transcript },
    },
  });
}
