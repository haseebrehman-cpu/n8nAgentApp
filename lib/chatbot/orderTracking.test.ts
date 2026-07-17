import { describe, expect, it } from "vitest";
import {
  isValidEmailInput,
  isValidOrderNumberInput,
  normalizeEmail,
  normalizeOrderNumber,
} from "@/lib/chatbot/orderTracking";

describe("normalizeOrderNumber", () => {
  it("accepts numeric and custom names", () => {
    expect(normalizeOrderNumber("1001")).toBe("1001");
    expect(normalizeOrderNumber("#1001")).toBe("1001");
    expect(normalizeOrderNumber("OT-cbn4m39wmd")).toBe("OT-cbn4m39wmd");
    expect(normalizeOrderNumber("order #1001")).toBe("1001");
  });

  it("rejects long sentences without an order token", () => {
    expect(
      normalizeOrderNumber("hello there how are you doing today friend")
    ).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("normalizes valid emails", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(isValidEmailInput("a@b.co")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(isValidEmailInput("")).toBe(false);
  });
});

describe("isValidOrderNumberInput", () => {
  it("validates tokens", () => {
    expect(isValidOrderNumberInput("1044")).toBe(true);
    expect(isValidOrderNumberInput("hello world this is long")).toBe(false);
  });
});
