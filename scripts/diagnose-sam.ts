// Diagnoses SAM misses on the cable images. Makes LIVE Meta calls: run by hand.
//
//   META_SAM_API_KEY=... npx tsx scripts/diagnose-sam.ts
//
// Budget: one /files upload per file (4) + one /responses call per
// (file x prompt x repeat) = 4 x 10 x 3 = 120. Total 124 calls.
// Never prints the key, headers or error bodies. Read-only: writes nothing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { META_BASE_URL, META_TIMEOUT_MS } from "../lib/meta/http";
import { SAM_MODEL, parseSamStream } from "../lib/meta/sam";

const IMAGE_DIR = join(process.cwd(), "bench", "assets", "images");
const FILES = ["n-full.png", "n-full-b.png", "n-full-c.png", "w-mug-cable.png"]; // no h-* files
const CABLE_PROMPTS = ["USB-C cable", "usb cable", "charging cable", "black cable", "cable", "cord", "wire", "charger cable"];
const CONTROL_PROMPTS = ["red mug", "blue notebook"];
const PROMPTS = [...CABLE_PROMPTS, ...CONTROL_PROMPTS];
const REPEATS = 3;
const PAUSE_MS = 500;

const key = process.env.META_SAM_API_KEY;
if (!key) {
  console.error("Set META_SAM_API_KEY in the environment.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const statusClass = (s: number) => `${Math.floor(s / 100)}xx`;

interface Row {
  file: string;
  prompt: string;
  rep: number;
  status: string; // "2xx" | "4xx" | "5xx" | "timeout" | "network" | "incomplete"
  ms: number;
  boxes: number;
  scores: string;
  fields: string;
}

const rows: Row[] = [];
let calls = 0;

function auth(): Headers {
  const h = new Headers();
  h.set("Authorization", `Bearer ${key}`);
  return h;
}

async function upload(file: string): Promise<string | null> {
  const bytes = readFileSync(join(IMAGE_DIR, file));
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "frame.png");
  calls++;
  try {
    const res = await fetch(`${META_BASE_URL}/files`, {
      method: "POST",
      headers: auth(),
      body: form,
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(`upload ${file}: HTTP ${statusClass(res.status)}`);
      return null;
    }
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === "string" ? body.id : null;
  } catch (e) {
    console.log(`upload ${file}: ${(e as Error).name === "TimeoutError" ? "timeout" : "network error"}`);
    return null;
  }
}

/** Event types and the keys of the completed response, for the field-names column. */
function describeFields(raw: string): string {
  const types = new Set<string>();
  let respKeys = "";
  let itemTypes = "";
  for (const ev of raw.split(/\r?\n\r?\n/)) {
    const data = ev
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      const p = JSON.parse(data) as { type?: string; response?: Record<string, unknown> };
      if (p.type) types.add(p.type);
      if (p.type === "response.completed" && p.response) {
        respKeys = Object.keys(p.response).join(",");
        const out = p.response.output;
        if (Array.isArray(out)) itemTypes = out.map((o) => String((o as { type?: unknown })?.type)).join(",");
      }
    } catch {
      /* ignore */
    }
  }
  return `events=[${[...types].join(",")}] response=[${respKeys}] output=[${itemTypes}]`;
}

async function ask(file: string, fileId: string, prompt: string, rep: number): Promise<Row> {
  const t0 = Date.now();
  calls++;
  const base = { file, prompt, rep };
  try {
    const res = await fetch(`${META_BASE_URL}/responses`, {
      method: "POST",
      headers: (() => {
        const h = auth();
        h.set("Content-Type", "application/json");
        h.set("Accept", "text/event-stream");
        return h;
      })(),
      body: JSON.stringify({
        model: SAM_MODEL,
        stream: true,
        metadata: { mask_encoding: "lossless" },
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", file_id: fileId }] }],
      }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ...base, status: statusClass(res.status), ms: Date.now() - t0, boxes: 0, scores: "-", fields: "-" };
    }
    const raw = await res.text(); // whole stream; same parser as production
    const parsed = parseSamStream(raw);
    const scoreMatches = [...parsed.text.matchAll(/score[^0-9\-]{0,6}(-?\d*\.?\d+)/gi)].map((m) => m[1]);
    return {
      ...base,
      status: parsed.completed ? "2xx" : "incomplete",
      ms: Date.now() - t0,
      boxes: parsed.boxCount,
      scores: scoreMatches.length ? scoreMatches.join("/") : "-",
      fields: describeFields(raw),
    };
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return { ...base, status: timeout ? "timeout" : "network", ms: Date.now() - t0, boxes: 0, scores: "-", fields: "-" };
  }
}

async function main() {
  console.log(`Planned calls: ${FILES.length} uploads + ${FILES.length * PROMPTS.length * REPEATS} responses`);
  for (const file of FILES) {
    const fileId = await upload(file);
    if (!fileId) continue;
    await sleep(PAUSE_MS);
    for (const prompt of PROMPTS) {
      for (let rep = 1; rep <= REPEATS; rep++) {
        const row = await ask(file, fileId, prompt, rep);
        rows.push(row);
        console.log(
          `${file.padEnd(16)} ${JSON.stringify(prompt).padEnd(18)} #${rep} ${row.status.padEnd(10)} ${String(row.ms).padStart(5)}ms boxes=${row.boxes} scores=${row.scores} ${rep === 1 ? row.fields : ""}`,
        );
        await sleep(PAUSE_MS);
      }
    }
  }

  const detected = (r: Row) => r.status === "2xx" && r.boxes >= 1;
  const summarize = (label: string, groups: Map<string, Row[]>) => {
    console.log(`\nDetection rate per ${label}:`);
    for (const [k, rs] of groups) {
      const ok = rs.filter((r) => r.status === "2xx");
      const hit = rs.filter(detected).length;
      console.log(`  ${k.padEnd(18)} ${hit}/${rs.length} detected (${ok.length} ok responses)`);
    }
  };
  const by = (f: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(f(r), [...(m.get(f(r)) ?? []), r]);
    return m;
  };
  summarize("prompt", by((r) => r.prompt));
  summarize("file", by((r) => r.file));

  console.log("\nCable prompts x file (hits of 3):");
  for (const p of PROMPTS) {
    console.log(`  ${p.padEnd(16)} ` + FILES.map((f) => `${f}=${rows.filter((r) => r.file === f && r.prompt === p && detected(r)).length}/3`).join("  "));
  }

  const bad = rows.filter((r) => r.status !== "2xx");
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\nNon-2xx/failed: ${bad.length} (timeouts ${rows.filter((r) => r.status === "timeout").length}, 429-class 4xx ${rows.filter((r) => r.status === "4xx").length}, 5xx ${rows.filter((r) => r.status === "5xx").length}, incomplete ${rows.filter((r) => r.status === "incomplete").length})`);
  if (lat.length) console.log(`Latency ms: median ${lat[Math.floor(lat.length / 2)]}, p95 ${lat[Math.floor(lat.length * 0.95)]}, max ${lat[lat.length - 1]}`);
  console.log(`Meta calls made: ${calls}`);
}

main().catch(() => {
  console.error("diagnose-sam failed unexpectedly");
  process.exit(1);
});
