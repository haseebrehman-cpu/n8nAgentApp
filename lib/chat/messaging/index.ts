/**
 * Messaging barrel: canned replies, response format contract, templates,
 * and customer-reply polish used across the chatbot.
 */

export * from "@/lib/chat/messaging/replies";
export {
  RESPONSE_FORMAT_RULES,
  MAX_SENTENCES_PER_PARAGRAPH,
  formatSection,
  formatBulletList,
  formatFact,
  joinSections,
  formatProductCard,
} from "@/lib/chat/messaging/response-format";
export {
  renderProductShortlist,
  SHORTLIST_DISPLAY_LIMIT,
} from "@/lib/chat/response/shortlist";
export {
  RESPONSE_TEMPLATES_PROMPT,
  TEMPLATE_PRODUCT_SEARCH,
  TEMPLATE_PRODUCT_DETAILS,
  TEMPLATE_COMPARISON,
  TEMPLATE_CATEGORY_LISTING,
  TEMPLATE_FULL_LIST,
  TEMPLATE_RECOMMENDATIONS,
  TEMPLATE_ACCESSORIES,
  TEMPLATE_OUT_OF_STOCK,
  TEMPLATE_NO_RESULTS,
  TEMPLATE_FAQ,
  TEMPLATE_INVENTORY,
} from "@/lib/chat/messaging/templates";
export { polishCustomerReply } from "@/lib/chat/messaging/polish";
export {
  GREETING_REPLY,
  THANKS_REPLY,
  GOODBYE_REPLY,
  ORDER_CANCEL_REPLY,
  ORDER_MODIFY_REPLY,
  ADDRESS_CHANGE_REPLY,
  CONTACT_SUPPORT_REPLY,
} from "@/lib/chat/messaging/journey-replies";
