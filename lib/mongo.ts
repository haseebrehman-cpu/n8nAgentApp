import mongoose from "mongoose";

type Mongoose = typeof mongoose;

interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache ?? { conn: null, promise: null };
global.mongooseCache = cached;

async function dbConnect() {
  const MONGODB_URL = process.env.MONGO_URI;
  if (!MONGODB_URL) {
    throw new Error("MONGO_URI is not defined");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URL, {
      bufferCommands: false,
      // Prefer explicit db so Atlas does not fall back to the default `test` database.
      dbName: process.env.MONGO_DB_NAME || "main",
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    throw error;
  }

  return cached.conn;
}

export default dbConnect;
