import mongoose from "mongoose";


const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "assistant", "system"],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  tokens: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

const chatSchema = new mongoose.Schema({
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
  totalMessages: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

const Chat = mongoose.models.Chat || mongoose.model("Chat", chatSchema);

export default Chat;