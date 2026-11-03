// Demo video card: nothing from YouTube loads before the click, and every
// video link is built from the one YOUTUBE_ID.

import { describe, expect, it } from "vitest";
import DemoVideo, { DemoVideoFrame } from "../../components/home/DemoVideo";
import { YOUTUBE_EMBED_URL, YOUTUBE_ID, YOUTUBE_WATCH_URL } from "./demo-video";
import { html, render, tags } from "./test-utils";
import { createElement } from "react";

describe("demo video card", () => {
  const card = render(DemoVideo);

  it("renders the poster as a real button and no iframe before the click", () => {
    const button = tags(card, "button")[0];
    expect(button.type).toBe("button");
    expect(button["aria-label"]).toBe("Play the 3 minute demo here");
    expect(card).not.toContain("<iframe");
    expect(card).not.toContain("youtube-nocookie");
  });

  it("makes no third-party request before the click: the only YouTube mention is the outbound link", () => {
    const refs = [...card.matchAll(/(?:src|srcSet|href)="([^"]*youtube[^"]*)"/gi)].map((m) => m[1]);
    expect(refs).toEqual([YOUTUBE_WATCH_URL]);
    expect(tags(card, "img").every((i) => !/^https?:/.test(i.src ?? ""))).toBe(true);
  });

  it("shows the poster image from /brand, with the 3:10 badge", () => {
    expect(card).toContain("demo-poster.jpg");
    expect(card).toContain("3:10");
  });

  it("links to YouTube in a new tab with noopener noreferrer", () => {
    const a = tags(card, "a")[0];
    expect(a.href).toBe(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`);
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
  });

  it("after the click shows the privacy-enhanced iframe in the same 16:9 box", () => {
    const playing = html(createElement(DemoVideoFrame, { playing: true }));
    const iframe = tags(playing, "iframe")[0];
    expect(iframe.src.startsWith("https://www.youtube-nocookie.com/embed/")).toBe(true);
    expect(iframe.src).toContain(YOUTUBE_ID);
    expect(iframe.src).toContain("autoplay=1");
    expect(iframe.title).toBe("SafeLabs Guard demo video");
    expect(iframe.referrerPolicy).toBe("strict-origin-when-cross-origin");
    expect(iframe.allowfullscreen).toBeDefined();
    expect(iframe.allow).toContain("autoplay");
    expect(playing).toContain("aspect-video");
    expect(YOUTUBE_EMBED_URL).toContain(`/embed/${YOUTUBE_ID}?`);
  });
});
