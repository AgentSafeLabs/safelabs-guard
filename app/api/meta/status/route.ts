// Server-only spike: reports whether Spark / SAM / Voice run live or mock.
// GET /api/meta/status          -> configured mode per client (no API calls)
// GET /api/meta/status?probe=1  -> also makes one tiny call per client and
//                                   reports the source actually used + error.
// Never returns keys, only whether each one is set.

import { NextResponse } from "next/server";
import { getSamClient } from "@/lib/meta/sam";
import { getSparkClient } from "@/lib/meta/spark";
import { getVoiceClient } from "@/lib/meta/voice";

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

export async function GET(request: Request) {
  const spark = getSparkClient();
  const sam = getSamClient();
  const voice = getVoiceClient();

  const status = {
    useMocks: process.env.SAFELABS_USE_MOCKS ?? null,
    spark: { mode: spark.mode, keySet: Boolean(process.env.META_SPARK_API_KEY) },
    sam: { mode: sam.mode, keySet: Boolean(process.env.META_SAM_API_KEY) },
    voice: { mode: voice.mode, keySet: Boolean(process.env.META_VOICE_API_KEY) },
  };

  if (new URL(request.url).searchParams.get("probe") !== "1") {
    return NextResponse.json(status);
  }

  const [sparkOut, samOut, voiceOut] = await Promise.all([
    spark.reason({ orderId: "ORDER-1042", step: "VERIFY_MUG" }),
    sam.segment({ frame: PROBE_PNG, concepts: ["cardboard box"] }),
    voice.transcribe({ audio: silentWavDataUri() }),
  ]);

  return NextResponse.json({
    ...status,
    probe: {
      spark: { source: sparkOut.source, error: sparkOut.error ?? null, objects: sparkOut.objects },
      sam: { source: samOut.source, error: samOut.error ?? null, verified: samOut.detections.length > 0 },
      voice: { source: voiceOut.source, error: voiceOut.error ?? null, transcript: voiceOut.transcript },
    },
  });
}
