import { describe, expect, it } from "vitest";
import {
  followUpOptionsFromChildren,
  matchCollections,
} from "@/lib/chat/catalog/category-discovery";

const FIXTURE = [
  { handle: "boxing", title: "Boxing", productsCount: 100 },
  { handle: "boxing-gloves", title: "Boxing Gloves", productsCount: 40 },
  {
    handle: "boxing-gloves-training",
    title: "Training Boxing Gloves",
    productsCount: 12,
  },
  { handle: "boxing-punch-bags", title: "Punch Bags", productsCount: 20 },
  { handle: "yoga", title: "Yoga", productsCount: 30 },
  { handle: "yoga-mats", title: "Yoga Mats", productsCount: 15 },
  { handle: "yoga-straps", title: "Yoga Straps", productsCount: 8 },
  { handle: "running", title: "Running", productsCount: 25 },
  { handle: "sale-clearance", title: "Clearance Sale", productsCount: 200 },
];

describe("category discovery", () => {
  it("matches live collections without hardcoded category lists", () => {
    const result = matchCollections("yoga straps", FIXTURE);
    expect(result.primary?.handle).toBe("yoga-straps");
    expect(result.needsClarification).toBe(false);
  });

  it("supports newly added collections with zero code changes", () => {
    const result = matchCollections("running", FIXTURE);
    expect(result.primary?.handle).toBe("running");
  });

  it("asks for clarification on ultra-broad department tokens", () => {
    const result = matchCollections("boxing", FIXTURE);
    expect(result.matches.length).toBeGreaterThan(1);
    expect(result.needsClarification).toBe(true);
  });

  it("builds dynamic follow-up options from children", () => {
    const result = matchCollections("yoga", FIXTURE);
    const options = followUpOptionsFromChildren(result.children);
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => /mat|strap/i.test(o))).toBe(true);
  });

  it("does not prefer marketing collections for plain queries", () => {
    const result = matchCollections("boxing gloves", FIXTURE);
    expect(result.primary?.handle).not.toContain("sale");
  });

  it("matches plain yoga straps to the plain strap collection when present", () => {
    const withPlain = [
      ...FIXTURE,
      {
        handle: "yoga-strap-plain",
        title: "Plain Yoga Straps",
        productsCount: 1,
      },
      {
        handle: "yoga-strap-color-straps",
        title: "Color Straps",
        productsCount: 22,
      },
    ];
    const result = matchCollections("plain yoga straps", withPlain);
    expect(result.primary?.handle).toBe("yoga-strap-plain");
  });
});