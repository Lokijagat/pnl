import mongoose from "mongoose";
import { env } from "./config/env";
import { logger } from "./lib/logger";

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
  logger.info("✅ MongoDB connected");
}
