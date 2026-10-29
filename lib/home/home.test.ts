// Home page "/": CTAs, FAQ wording, blog link, progress labels, metadata.

import { describe, expect, it } from "vitest";
import Home, { metadata } from "../../app/page";
import { BLOG_URL } from "../nav/links";
import { FAQ } from "./faq";
import { render, tags, text } from "../site/test-utils";

const QUESTIONS = [
  "What does Safelabs Guard stop?",
  "Does an AI model make the final decision?",
  "What happens if a part is down?",
  "Is the shipment real?",
  "What did it catch in testing, and what didn't it?",
  "Which languages does voice support?",
  "Can it verify my own products?",
  "Is it only for e-commerce?",
];

describe("home page /", () => {
  const page = render(Home);
  const copy = text(page);

  it("has the title and description from the brief", () => {
    expect(String(metadata.title)).toBe("Safelabs Guard: verify what the agent sees before it acts");
    expect(String(metadata.description)).not.toBe("");
  });

  it("has the hero copy and both calls to action", () => {
    expect(copy).toContain("Runtime guardrail for multimodal agents");
    expect(copy).toContain("Verify what the agent sees before it acts.");
    expect(copy).toContain("A deterministic check between your agent and its next action.");
    const links = tags(page, "a");
    const live = links.find((a) => a.href === "/live" && /min-h-12/.test(a.class));
    const scenarios = links.find((a) => a.href === "/scenarios" && /min-h-12/.test(a.class));
    expect(live).toBeDefined();
    expect(scenarios).toBeDefined();
    expect(copy).toContain("Try the live agent");
    expect(copy).toContain("See scenarios");
  });

  it("shows the one-turn card with a HOLD that has an icon and a word", () => {
    expect(copy).toContain("One turn, in short");
    expect(copy).toContain("Agent proposes: Verify the notebook");
    expect(copy).toContain("Evidence: Frame shows a mug only");
    expect(copy).toMatch(/HOLD\s+They disagree, so nothing runs\./);
  });

  it("has the pipeline boxes and the two outcome chips", () => {
    for (const s of ["Camera frame", "Voice clip", "SAM 3.1", "finds objects", "OCR", "reads text in frame", "Muse Voice", "transcribes speech", "Muse Spark", "proposes an action from a text report", "fixed rules, no AI model", "ALLOW", "HOLD"]) {
      expect(copy, s).toContain(s);
    }
    expect(page).toContain("border-2 border-accent");
  });

  it("has the two outcome cards and the three check cards", () => {
    for (const s of ["Without the guard", "With Safelabs Guard", "Banana in box", "Advances anyway", "Held. Not a notebook.", "Right object", "Matches the order's ledger.", "Hidden instructions", "Signs and spoken commands are flagged.", "Fails closed", "Any part down means hold."]) {
      expect(copy, s).toContain(s);
    }
  });

  it("shows the five progress labels, all filled", () => {
    const list = /<ol[^>]*aria-label="Order steps, all verified"[^>]*>(.*?)<\/ol>/s.exec(page)?.[1] ?? "";
    expect(text(list).replace(/\([a-z ]+\)/g, "").split(" ").filter(Boolean)).toEqual(["Mug", "Notebook", "Cable", "Seal", "Ship"]);
    expect(list.match(/bg-accent/g)).toHaveLength(5);
  });

  it("lists what was tested live and the limits", () => {
    for (const s of ["Tested live", "Missing items", "Wrong objects", "Signs in frame", "Spoken commands", "Limits", "Shipment simulated", "English voice only", "Hackathon demo"]) {
      expect(copy, s).toContain(s);
    }
  });

  it("has exactly 8 FAQ items with the exact questions, the first open", () => {
    const items = [...page.matchAll(/<details[^>]*data-faq-item[^>]*>(.*?)<\/details>/gs)];
    expect(items).toHaveLength(8);
    const questions = items.map((m) => text(/<summary[^>]*>(.*?)<\/summary>/s.exec(m[1])![1]).trim());
    expect(questions).toEqual(QUESTIONS);
    expect(FAQ.map((f) => f.question)).toEqual(QUESTIONS);
    const open = [...page.matchAll(/<details([^>]*)data-faq-item/g)].map((m) => /\sopen(=|\s|$)/.test(m[1]));
    expect(open).toEqual([true, false, false, false, false, false, false, false]);
  });

  it("gives each FAQ summary a 56px row and its answer in the page", () => {
    expect(page.match(/<summary[^>]*min-h-14/g)).toHaveLength(8);
    for (const { answer } of FAQ) expect(copy).toContain(answer);
  });

  it("links the Safe Labs blog in a new tab", () => {
    const a = tags(page, "a").filter((x) => x.href === BLOG_URL);
    expect(a.length).toBeGreaterThanOrEqual(2); // under the FAQ and in the footer
    for (const link of a) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
      expect(link.rel).toContain("noreferrer");
    }
    expect(copy).toContain("Read more on the Safe Labs blog");
  });

  it("has the footer", () => {
    expect(copy).toContain("Built by Safe Labs AI Inc.");
    for (const s of ["Live agent", "Scenarios", "Blog", "Source on GitHub"]) expect(copy).toContain(s);
  });
});
