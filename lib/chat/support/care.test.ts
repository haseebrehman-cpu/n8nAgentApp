import { describe, expect, it } from "vitest";
import {
  buildCareFallbackReply,
  isCareQuestion,
} from "@/lib/chat/support/care";

describe("care support", () => {
  it("detects care questions that are not product searches", () => {
    expect(isCareQuestion("Can this punch bag get wet?")).toBe(true);
    expect(isCareQuestion("Can I wash it?")).toBe(true);
    expect(isCareQuestion("Can I leave it outside?")).toBe(true);
    expect(isCareQuestion("can i make it heavier at all with sand etc")).toBe(true);
    expect(isCareQuestion("can I fill it with sand?")).toBe(true);
    expect(isCareQuestion("show me boxing gloves")).toBe(false);
  });

  it("gives practical guidance for sand/filling questions", () => {
    const reply = buildCareFallbackReply("can i make it heavier at all with sand etc", [
      "RDX F6 4ft / 5ft 2-in-1 KARA Training Punching Bag Set",
    ]);
    expect(reply.toLowerCase()).toContain("sand");
    expect(reply.toLowerCase()).toContain("textiles");
  });

  it("gives natural outdoor/moisture guidance", () => {
    const reply = buildCareFallbackReply("Can this punch bag get wet?", [
      "Freestanding Punch Bag",
    ]);
    expect(reply.toLowerCase()).toContain("rain");
    expect(reply.toLowerCase()).not.toMatch(/i don't know/);
    expect(reply.toLowerCase()).not.toMatch(/no information available/);
  });

  it("uses practical fallback phrasing when docs are missing", () => {
    const reply = buildCareFallbackReply("How do I clean this?", ["Yoga Mat"]);
    expect(reply).toMatch(/couldn't find any official guidance/i);
  });
});
