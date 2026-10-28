import { describe, expect, it, vi } from "vitest";
import { sendTurn, TURN_URL } from "./agent-api";
import { checkUpload, UPLOAD_ACCEPT } from "./upload";

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];

function file(bytes: number[] | Uint8Array, type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

describe("checkUpload", () => {
  it("accepts JPEG and PNG", async () => {
    expect(await checkUpload(file([...JPEG_HEAD, 1, 2], "image/jpeg"))).toEqual({ ok: true });
    expect(await checkUpload(file([...PNG_HEAD, 1, 2], "image/png"))).toEqual({ ok: true });
    expect(UPLOAD_ACCEPT).toBe("image/jpeg,image/png");
  });

  it("rejects other types, empty files, mislabelled bytes and files over 8 MB", async () => {
    expect((await checkUpload(file([...PNG_HEAD], "image/webp"))).ok).toBe(false);
    expect((await checkUpload(file([...PNG_HEAD], "image/gif"))).ok).toBe(false);
    expect((await checkUpload(file([], "image/png"))).ok).toBe(false);
    expect(await checkUpload(file([...JPEG_HEAD], "image/png"))).toEqual({ ok: false, error: "That file is not a valid JPEG or PNG image." });
    expect((await checkUpload(file(Array.from(Buffer.from("<svg/>")), "image/jpeg"))).ok).toBe(false);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(JPEG_HEAD);
    expect(await checkUpload(file(big, "image/jpeg"))).toEqual({ ok: false, error: "That image is larger than 8 MB." });
  });

  it("an accepted upload is sent exactly like a camera frame", async () => {
    const reply = () =>
      new Response(
        JSON.stringify({
          turn: { turn: 1, step: "VERIFY_MUG", guard: null },
          session: "s",
          ledger: { step: "VERIFY_MUG", stepIndex: 0, status: "IN_PROGRESS" },
          shipped: false,
          sources: { sam: "mock", voice: "unavailable", vision: "mock", spark: "mock" },
        }),
        { status: 200 },
      );
    const fetchImpl = vi.fn<typeof fetch>(async () => reply());
    const uploaded = file([...PNG_HEAD, 9], "image/png");
    const captured = file([...JPEG_HEAD, 9], "image/jpeg");
    await sendTurn({ mode: "guarded", token: null, image: uploaded }, fetchImpl);
    await sendTurn({ mode: "guarded", token: null, image: captured }, fetchImpl);
    const forms = fetchImpl.mock.calls.map(([url, init]) => {
      expect(url).toBe(TURN_URL);
      return init?.body as FormData;
    });
    expect(Array.from(forms[0].keys())).toEqual(Array.from(forms[1].keys()));
    expect((forms[0].get("image") as File).name).toBe((forms[1].get("image") as File).name);
  });
});
