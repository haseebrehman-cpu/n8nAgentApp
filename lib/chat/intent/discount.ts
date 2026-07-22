/**
 * Discount / sale intent detection. A "code" request (coupon/promo code) is
 * handled differently from a general "what's on sale" question, so the two are
 * distinguished here. Leaf module with no chat-domain dependencies.
 */

/** True when the customer is asking for a coupon / promo / discount code. */
export function isDiscountCodeQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(discount\s*codes?|promo\s*codes?|promocodes?|coupon\s*codes?|coupons?|vouchers?|gift\s*codes?)\b/i.test(
      t,
    ) ||
    (/\b(codes?)\b/i.test(t) &&
      /\b(discount|promo|promotional|coupon|voucher)\b/i.test(t))
  );
}

/** General sale/discount phrasing (not a code request). */
export function isDiscountQuery(text: string): boolean {
  if (isDiscountCodeQuery(text)) return false;
  return /\b(discount|discounts|discounted|sale|sales|on\s+sale|offer|offers|deal|deals|reduced|clearance|promo|promotion|promotions|bargain|markdown)\b/i.test(
    text,
  );
}
