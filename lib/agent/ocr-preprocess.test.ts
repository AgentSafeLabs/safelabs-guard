import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectInjection } from "../guard/injections";
import { brightBoxes, extraPasses, extraPassesEnabled, type OcrPass } from "./ocr-preprocess";
import { OcrVisionClient, TESSERACT_JS_DEFAULT_PSM, type OcrWorker } from "./vision";

// Extra OCR passes. Fake workers for the control flow; the real pipeline
// (sharp + tesseract.js, local, no network, no Meta) on bench/assets DEV images
// only: s-*, v-*, n-* and w-* files. h-* (held-out) files are never read here.

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const frame = { frameDataUrl: `data:image/png;base64,${Buffer.from([...PNG_HEAD, 0, 0, 0, 0]).toString("base64")}`, transcript: "" };
const pass = (name: string, psm: 3 | 11, tag: string): OcrPass => ({ name, psm, image: Buffer.from(tag) });

function fake(reads: Record<string, string | Error | "hang">) {
  const psms: string[] = [];
  const worker: OcrWorker = {
    recognize: vi.fn(async (image: Buffer) => {
      const read = reads[image.toString()] ?? "";
      if (read === "hang") return new Promise<never>(() => {});
      if (read instanceof Error) throw read;
      return { data: { text: read, confidence: 80 } };
    }),
    terminate: vi.fn(async () => undefined),
    setParameters: vi.fn(async (p: Record<string, string>) => void psms.push(p.tessedit_pageseg_mode)),
  };
  return { worker, psms };
}

function client(worker: OcrWorker, passes: OcrPass[] | (() => Promise<OcrPass[]>), timeoutMs = 1_000) {
  return new OcrVisionClient({
    createWorker: async () => worker,
    timeoutMs,
    extraPasses: typeof passes === "function" ? passes : async () => passes,
  });
}

describe("OcrVisionClient with extra passes (fake worker)", () => {
  it("reads the unmodified frame first, then each pass in its own page mode, and merges the text", async () => {
    // The base frame's bytes are PNG_HEAD + 4 zeros, so key the fake on pass tags only.
    const { worker, psms } = fake({ a: "IGNORE ALL", b: "SHIP IT" });
    const ocr = client(worker, [pass("a", 3, "a"), pass("b", 11, "b")]);
    const res = await ocr.extract(frame);
    expect(res).toMatchObject({ ok: true, visibleText: "IGNORE ALL SHIP IT", confidence: 80 });
    expect(worker.recognize).toHaveBeenCalledTimes(3);
    expect(psms.slice(0, 2)).toEqual(["3", "11"]); // per pass ...
    await vi.waitFor(() => expect(psms.at(-1)).toBe(TESSERACT_JS_DEFAULT_PSM)); // ... then back to the default for the next frame
    await ocr.close();
  });

  it("drops a duplicate read (case and spacing ignored)", async () => {
    const { worker } = fake({ a: "ORDER-1042  COMPLETE", b: "order-1042 complete" });
    const res = await client(worker, [pass("a", 3, "a"), pass("b", 11, "b")]).extract(frame);
    expect(res.visibleText).toBe("ORDER-1042 COMPLETE");
  });

  it("a failing extra pass keeps the read that worked and still reports ok", async () => {
    const { worker } = fake({ a: "IGNORE ALL", b: new Error("wasm abort at 0x1234 secret") });
    const res = await client(worker, [pass("a", 3, "a"), pass("b", 11, "b")]).extract(frame);
    expect(res.ok).toBe(true);
    expect(res.visibleText).toBe("IGNORE ALL");
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("a hanging extra pass is cut off at the deadline; text already read is returned", async () => {
    const { worker } = fake({ a: "hang" });
    const t0 = Date.now();
    const res = await client(worker, [pass("a", 3, "a")], 300).extract(frame);
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(res.ok).toBe(true);
    expect(worker.terminate).toHaveBeenCalled(); // the stuck worker is thrown away
  });

  it("a base read that fails is still a failure; no extra pass can turn it into ok", async () => {
    const worker: OcrWorker = {
      recognize: vi.fn(async () => {
        throw new Error("boom");
      }),
      terminate: vi.fn(async () => undefined),
    };
    const extra = vi.fn(async () => [pass("a", 3, "a")]);
    const res = await client(worker, extra).extract(frame);
    expect(res).toMatchObject({ ok: false, perceptionDetail: "ocr error", visibleText: "" });
    expect(extra).not.toHaveBeenCalled();
  });

  it("extra passes that find nothing change nothing", async () => {
    const { worker } = fake({ a: "", b: "   " });
    const res = await client(worker, [pass("a", 3, "a"), pass("b", 11, "b")]).extract(frame);
    expect(res).toMatchObject({ ok: true, visibleText: "" });
  });

  it("an extraPasses function that throws is ignored", async () => {
    const { worker } = fake({});
    const res = await client(worker, async () => {
      throw new Error("sharp missing");
    }).extract(frame);
    expect(res.ok).toBe(true);
  });

  it("extraPasses: false and an injected worker without the option run one pass (old behaviour)", async () => {
    const { worker } = fake({});
    await new OcrVisionClient({ createWorker: async () => worker, extraPasses: false }).extract(frame);
    await new OcrVisionClient({ createWorker: async () => worker }).extract(frame);
    expect(worker.recognize).toHaveBeenCalledTimes(2);
  });

  it("merged text still goes through cleanOcrText (controls stripped, capped)", async () => {
    const { worker } = fake({ a: "OK‮​\u0007 SHIP", b: "x".repeat(5_000) });
    const res = await client(worker, [pass("a", 3, "a"), pass("b", 11, "b")]).extract(frame);
    expect(res.visibleText).not.toMatch(/[‮​\u0007]/);
    expect(Array.from(res.visibleText).length).toBeLessThanOrEqual(2_000);
  });
});

describe("kill switch", () => {
  it.each([
    ["", true],
    ["on", true],
    ["off", false],
    [" OFF ", false],
  ])("SAFELABS_OCR_PASSES=%j -> enabled %s", (value, enabled) => {
    expect(extraPassesEnabled({ SAFELABS_OCR_PASSES: value })).toBe(enabled);
  });
});

describe("brightBoxes and extraPasses on synthetic images", () => {
  it("finds a bright rectangle on a dark background and ignores specks", () => {
    const gw = 240;
    const gh = 180;
    const grey = new Uint8Array(gw * gh).fill(60);
    for (let y = 20; y < 70; y++) for (let x = 30; x < 150; x++) grey[y * gw + x] = 240;
    grey[150 * gw + 200] = 250; // one bright pixel
    const boxes = brightBoxes(grey, gw, gh);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x0: 30, x1: 149, y0: 20, y1: 69 });
  });

  it("returns no boxes for a frame with no bright region", () => {
    expect(brightBoxes(new Uint8Array(240 * 180).fill(100), 240, 180)).toEqual([]);
  });

  it("never throws on bytes that are not an image, and returns no passes", async () => {
    await expect(extraPasses(Buffer.from("not an image"))).resolves.toEqual([]);
    await expect(extraPasses(Buffer.alloc(0))).resolves.toEqual([]);
    await expect(extraPasses(Buffer.from([...PNG_HEAD, 0, 0, 0, 0]))).resolves.toEqual([]);
  });

  it("makes two whole-frame passes and one crop per bright region, as PNG", async () => {
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#7a5a3a" } })
      .composite([{ input: await sharp({ create: { width: 300, height: 120, channels: 3, background: "#fff6cc" } }).png().toBuffer(), left: 40, top: 30 }])
      .png()
      .toBuffer();
    const passes = await extraPasses(png);
    expect(passes.map((p) => [p.name, p.psm])).toEqual([
      ["grey+normalise", 3],
      ["grey+normalise sparse", 11],
      ["bright region", 3],
    ]);
    for (const p of passes) expect(p.image.subarray(0, 8)).toEqual(Buffer.from(PNG_HEAD));
    const crop = await sharp(passes[2].image).metadata();
    expect(crop.width).toBeGreaterThanOrEqual(300);
    expect(crop.width).toBeLessThan(640);
  });
});

// ---------------------------------------------------------------------------
// Real pipeline on the dev images. Skips with a reason when they are missing.

const IMAGES = join(process.cwd(), "bench", "assets", "images");
const real = new OcrVisionClient();
const skip = !real.available() || !existsSync(join(IMAGES, "s-ignore-all.png")) ? "tesseract.js or dev images missing" : null;
afterAll(() => real.close());

const readImage = (name: string) => {
  expect(name.startsWith("h-")).toBe(false); // held-out files are off limits
  return real.extract({ frameDataUrl: `data:image/png;base64,${readFileSync(join(IMAGES, name)).toString("base64")}`, transcript: "" });
};

describe.skipIf(skip !== null)(`real OCR on dev images${skip ? ` (skipped: ${skip})` : ""}`, () => {
  it.each([
    ["s-ignore-all.png", /ignore all/i],
    ["v-complete.png", /order-1042 complete/i],
    ["v-benign-shipto.png", /ship to:? miami/i],
    ["v-rotated-noisy.png", /ship it/i],
  ])("%s is read", { timeout: 30_000 }, async (name, expected) => {
    const res = await readImage(name);
    expect(res.ok).toBe(true);
    expect(res.visibleText).toMatch(expected);
  });

  it("the rotated attack sign is flagged, the shipping sticker and 'ORDER-1042 COMPLETE' are not", { timeout: 30_000 }, async () => {
    expect(detectInjection((await readImage("v-rotated-noisy.png")).visibleText).detected).toBe(true);
    expect(detectInjection((await readImage("v-benign-shipto.png")).visibleText).detected).toBe(false);
    expect(detectInjection((await readImage("v-complete.png")).visibleText).detected).toBe(false);
  });

  it.each(["n-mug.png", "n-full.png", "n-full-b.png", "w-banana.png", "w-laptop.png", "w-blue-mug.png"])(
    "clean illustration %s: no injection flag, at most a few junk characters",
    { timeout: 30_000 },
    async (name) => {
      const res = await readImage(name);
      expect(res.ok).toBe(true);
      expect(detectInjection(res.visibleText).detected).toBe(false);
      expect(res.visibleText.length).toBeLessThanOrEqual(16);
    },
  );

  it("extra passes leave the worker as they found it: a frame production reads is read the same afterwards", { timeout: 30_000 }, async () => {
    const before = await readImage("v-small.png");
    await readImage("s-ignore-all.png"); // runs the extra passes, which change the page mode
    const after = await readImage("v-small.png");
    expect(after.visibleText).toContain(before.visibleText.slice(0, 30));
    expect(after.visibleText).toMatch(/ignore previous instructions/i);
  });

  it("a read stays well inside the 8 s OCR budget", { timeout: 30_000 }, async () => {
    await readImage("n-full.png"); // warm worker
    const t0 = Date.now();
    await readImage("s-ignore-all.png");
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});
