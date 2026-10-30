import { describe, expect, it } from "vitest";
import { isTypingTarget, planResultScroll, shouldRevealResult } from "./scroll";

const rect = (top: number, height: number) => ({ top, bottom: top + height, height });

describe("planResultScroll", () => {
  it("always scrolls on a stacked (mobile) layout, smoothly", () => {
    expect(planResultScroll({ stacked: true, reducedMotion: false, rect: rect(100, 200), viewportHeight: 800 })).toEqual({ scroll: true, behavior: "smooth" });
    expect(planResultScroll({ stacked: true, reducedMotion: false, rect: rect(2000, 200), viewportHeight: 800 })).toEqual({ scroll: true, behavior: "smooth" });
  });

  it("scrolls instantly when reduced motion is set", () => {
    expect(planResultScroll({ stacked: true, reducedMotion: true, rect: rect(2000, 200), viewportHeight: 800 })).toEqual({ scroll: true, behavior: "auto" });
    expect(planResultScroll({ stacked: false, reducedMotion: true, rect: rect(700, 300), viewportHeight: 800 })).toEqual({ scroll: true, behavior: "auto" });
  });

  it("does not scroll on desktop when the card is fully visible", () => {
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(100, 500), viewportHeight: 800 }).scroll).toBe(false);
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(0, 800), viewportHeight: 800 }).scroll).toBe(false);
  });

  it("scrolls on desktop when the card is cut off at the top or bottom", () => {
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(-20, 300), viewportHeight: 800 }).scroll).toBe(true);
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(600, 300), viewportHeight: 800 }).scroll).toBe(true);
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(900, 300), viewportHeight: 800 }).scroll).toBe(true);
  });

  it("for a card taller than the viewport, scrolls only when its top is off screen", () => {
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(50, 1500), viewportHeight: 800 }).scroll).toBe(false);
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(-50, 1500), viewportHeight: 800 }).scroll).toBe(true);
    expect(planResultScroll({ stacked: false, reducedMotion: false, rect: rect(900, 1500), viewportHeight: 800 }).scroll).toBe(true);
  });
});

describe("shouldRevealResult", () => {
  it("does nothing before any turn has finished (first render, Restart run)", () => {
    expect(shouldRevealResult({ finishedTurns: 0, recording: false })).toBe(false);
  });
  it("does nothing while the person is recording", () => {
    expect(shouldRevealResult({ finishedTurns: 3, recording: true })).toBe(false);
  });
  it("reveals after a finished turn", () => {
    expect(shouldRevealResult({ finishedTurns: 1, recording: false })).toBe(true);
  });
});

describe("isTypingTarget", () => {
  it("is true for form fields and editable content", () => {
    for (const tagName of ["INPUT", "textarea", "Select"]) expect(isTypingTarget({ tagName })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("is false for buttons, the body and nothing", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
