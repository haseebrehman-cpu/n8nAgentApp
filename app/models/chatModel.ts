import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

const shownProductSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: String, default: null },
    wasPrice: { type: String, default: null },
    url: { type: String, default: null },
    inStock: { type: Boolean, default: null },
    onSale: { type: Boolean, default: false },
  },
  { _id: false },
);

const chatSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    messages: [messageSchema],
    totalTokens: {
      type: Number,
      default: 0,
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    totalMessages: {
      type: Number,
      default: 0,
    },
    /** Latest classified turn intent, e.g. product_information, order_tracking. */
    intent: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Live conversation state machine (mirrors Redis session). */
    state: {
      type: String,
      enum: ["idle", "awaiting_order_number", "awaiting_order_email"],
      default: "idle",
    },
    pendingOrderNumber: {
      type: String,
      default: null,
    },
    pendingCategory: {
      type: String,
      default: null,
    },
    lastSearchQuery: {
      type: String,
      default: null,
    },
    /** Product memory for follow-up resolution after Redis TTL/restart. */
    lastShownProducts: {
      type: [shownProductSchema],
      default: undefined,
    },
    /** Optimistic concurrency counter mirrored from the live session. */
    version: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

const Chat = mongoose.models.Chat || mongoose.model("Chat", chatSchema);

export default Chat;
