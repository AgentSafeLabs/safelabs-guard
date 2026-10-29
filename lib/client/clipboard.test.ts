import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("uses the async clipboard when present", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("SHP-1")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("SHP-1");
  });

  it("returns false, and does not throw, when the clipboard rejects and there is no DOM", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.stubGlobal("document", undefined);
    expect(await copyText("SHP-1")).toBe(false);
  });

  it("falls back to a hidden textarea and execCommand", async () => {
    const area = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
    const body = { appendChild: vi.fn(), removeChild: vi.fn() };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => area, body, execCommand: vi.fn().mockReturnValue(true) });
    expect(await copyText("SHP-2")).toBe(true);
    expect(area.value).toBe("SHP-2");
    expect(body.removeChild).toHaveBeenCalled();
  });

  it("returns false when the fallback fails", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no");
      },
    });
    expect(await copyText("x")).toBe(false);
  });
});
