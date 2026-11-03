// Home page "/": CTAs, FAQ wording, blog link, progress labels, metadata.

import { describe, expect, it } from "vitest";
import Home, { metadata } from "../../app/page";
import { BLOG_URL, REPO_URL } from "../nav/links";
import { FAQ } from "./faq";
import { render, tags, text } from "../site/test-utils";

const QUESTIONS = [
  "What does SafeLabs Guard stop?",
  "Does an AI model make the final decision?",
  "What happens if a part is down?",
  "Is the shipment real?",
  "What did it catch in testing, and what didn't it?",
  "Which languages does voice support?",
  "Do you store my camera images or audio?",
  "Can it verify my own products?",
  "Is it only for e-commerce?",
];

describe("home page /", () => {
  const page = render(Home);
  const copy = text(page);

  it("has the title and description from the brief", () => {
    expect(String(metadata.title)).toBe("SafeLabs Guard: verify what the agent sees before it acts");
    expect(String(metadata.description)).not.toBe("");
  });

  it("has the hero copy and both calls to action", () => {
    expect(copy).toContain("A safety check for AI agents that use cameras and voice");
    expect(page).toMatch(/<h1[^>]*>Make sure your AI agent saw the right thing before it acts\.<\/h1>/);
    expect(copy).toContain(
      "SafeLabs Guard compares what an AI agent sees and hears with your plan. If something is wrong, missing or planted, the agent stops instead of acting.",
    );
    const links = tags(page, "a");
    expect(links.find((a) => a.href === "/live" && /min-h-12/.test(a.class))).toBeDefined();
    expect(links.find((a) => a.href === "/scenarios" && /min-h-12/.test(a.class))).toBeDefined();
    expect(copy).toContain("Try the live agent");
    expect(copy).toContain("See scenarios");
  });

  it("keeps the hero's source line on one line from lg", () => {
    const p = /<p[^>]*lg:whitespace-nowrap[^>]*>(.*?)<\/p>/s.exec(page)?.[1] ?? "";
    expect(text(p).trim()).toBe("Real phone camera · Muse Spark · SAM 3.1 · Muse Voice · Simulated shipment");
  });

  it("replaces the old hero card and numbers strip", () => {
    for (const gone of ["One turn, in short", "Same wrong object, two outcomes", "Banana in box", "Advances anyway", "Without the guard"]) {
      expect(copy, gone).not.toContain(gone);
    }
  });

  it("has the demo video card with a poster button and no iframe", () => {
    expect(page).toContain('aria-label="Play the 3 minute demo here"');
    expect(page).not.toContain("<iframe");
    expect(copy).toContain("Watch the 3-minute demo");
    expect(copy).toContain("A packing agent, a real phone camera, five checks. Plays right here.");
    expect(copy).toContain("3:10");
  });

  it("has the why-it-matters panel", () => {
    for (const s of ["Why it matters", "Agents can misread", "Hidden orders exist", "Mistakes are costly", "SafeLabs Guard holds the action until the evidence checks out."]) {
      expect(copy, s).toContain(s);
    }
  });

  it("has the three how-it-works cards in one row from lg", () => {
    for (const s of ["The guard sits between seeing and doing", "See and hear", "Check the ledger", "Allow or hold", "No model decides this step."]) {
      expect(copy, s).toContain(s);
    }
    expect(page).toMatch(/flex flex-col gap-3 lg:flex-row lg:flex-nowrap/);
    expect(page.match(/min-w-0 flex-1/g)).toHaveLength(3);
  });

  it("explains the ledger and lists the five steps", () => {
    for (const s of ["WHAT IT IS", "WHY IT IS NEEDED", "WHY WE USE IT"]) expect(copy.toUpperCase()).toContain(s);
    const list = /<ol[^>]*aria-label="Order steps"[^>]*>(.*?)<\/ol>/s.exec(page)?.[1] ?? "";
    for (const s of ["Mug", "Red mug in frame", "Notebook", "Blue notebook", "Cable", "USB-C cable", "Seal", "Box sealed", "Ship", "One-time approval"]) {
      expect(text(list), s).toContain(s);
    }
    expect(list.match(/border-accent/g)).toHaveLength(4);
    expect(list.match(/border-pending/g)).toHaveLength(1);
  });

  it("has the three rule cards and the two demo moments", () => {
    for (const s of ["Right object", "Hidden instructions", "Fails closed", "Wrong mug in frame", "Red mug in frame", "STEP 1 OF 5 · VERIFY THE MUG"]) {
      expect(copy.toUpperCase(), s).toContain(s.toUpperCase());
    }
    expect(page.match(/border-l-\[5px\]/g)).toHaveLength(2);
    expect(page.match(/border-t-\[3px\]/g)).toHaveLength(3);
  });

  it("lists what was tested live and the limits", () => {
    for (const s of [
      "Tested live, with limits",
      "Missing items and wrong objects",
      "Signs in frame with hidden instructions",
      "Spoken commands",
      "An extra item at the seal step",
      "The shipment is simulated",
      "English voice only",
      "A hackathon demo, not a product",
      "English-only voice allowlist",
    ]) {
      expect(copy, s).toContain(s);
    }
  });

  it("places the FAQ after the results and before the closing band", () => {
    const at = (s: string) => page.indexOf(s);
    expect(at("Tested live, with limits")).toBeLessThan(at('id="faq"'));
    expect(at('id="faq"')).toBeLessThan(at("Try it with your own camera."));
  });

  it("ends with the closing call to action", () => {
    expect(copy).toContain("Show the agent the right and the wrong object and watch what it decides.");
    const gh = tags(page, "a").find((a) => a.href === REPO_URL)!;
    expect(gh.target).toBe("_blank");
    expect(gh.rel).toBe("noopener noreferrer");
  });

  it("has exactly 9 FAQ items with the exact questions, the first open", () => {
    const items = [...page.matchAll(/<details[^>]*data-faq-item[^>]*>(.*?)<\/details>/gs)];
    expect(items).toHaveLength(9);
    const questions = items.map((m) => text(/<summary[^>]*>(.*?)<\/summary>/s.exec(m[1])![1]).trim());
    expect(questions).toEqual(QUESTIONS);
    expect(FAQ.map((f) => f.question)).toEqual(QUESTIONS);
    const open = [...page.matchAll(/<details([^>]*)data-faq-item/g)].map((m) => /\sopen(=|\s|$)/.test(m[1]));
    expect(open).toEqual([true, false, false, false, false, false, false, false, false]);
  });

  it("gives each FAQ summary a 56px row and its answer in the page", () => {
    expect(page.match(/<summary[^>]*min-h-14/g)).toHaveLength(9);
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

  it("gives the FAQ section the anchor the footer links to", () => {
    expect(page.match(/<section[^>]*\sid="faq"/g)).toHaveLength(1);
  });

  it("has the shared footer (details in footer.test.ts)", () => {
    expect(copy).toContain("Built by Waqar Javed");
    for (const s of ["Live agent", "Scenarios", "Demo video", "Blog", "GitHub"]) expect(copy).toContain(s);
  });
});
