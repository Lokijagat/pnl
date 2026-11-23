import { env } from "./config/env";
import { connectDb } from "./db";
import { createApp } from "./app";
import { logger } from "./lib/logger";
import { startWorker } from "./jobs/queue";
import { registerAllJobs, startScheduler } from "./jobs/handlers";

async function main() {
  await connectDb();
  registerAllJobs();
  // Abhi worker API process ke andar hi chalta hai. Scale par alag process: DISABLE_WORKER=1 API par.
  if (process.env.DISABLE_WORKER !== "1") {
    await startWorker();
    startScheduler();
  }
  createApp().listen(env.PORT, () => logger.info(`🚀 API running on http://localhost:${env.PORT}`));
}

main().catch((err) => {
  logger.error(err, "Startup failed");
  process.exit(1);
});
