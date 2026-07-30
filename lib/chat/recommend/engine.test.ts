import { describe, expect, it } from "vitest";
import { recommendProducts } from "@/lib/chat/recommend/engine";

const products = [
  {
    id: "1",
    title: "Beginner Training Gloves",
    price: "£25.00",
    wasPrice: null,
    url: null,
    inStock: true,
    onSale: false,
  },
  {
    id: "2",
    title: "Pro Competition Fight Gloves",
    price: "£90.00",
    wasPrice: null,
    url: null,
    inStock: true,
    onSale: false,
  },
  {
    id: "3",
    title: "Everyday Training Gloves",
    price: "£40.00",
    wasPrice: null,
    url: null,
    inStock: true,
    onSale: false,
  },
];

describe("recommendation engine", () => {
  it("prefers beginner products for beginner intent", () => {
    const picks = recommendProducts({
      products,
      preferences: { experience: "beginner" },
      limit: 2,
    });
    expect(picks[0]?.product.id).toBe("1");
  });

  it("prefers professional products for compete intent", () => {
    const picks = recommendProducts({
      products,
      preferences: { experience: "professional" },
      limit: 2,
    });
    expect(picks[0]?.product.id).toBe("2");
  });
});
