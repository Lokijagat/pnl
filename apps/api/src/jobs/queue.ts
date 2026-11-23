/**
 * Simple MongoDB-backed job queue.
 * - Atomic claim (findOneAndUpdate) → multiple API instances par bhi ek job ek hi baar chalega
 * - Exponential backoff retry
 * - Stale "running" jobs (crash ke baad) wapas queue mein
 * Scale chahiye ho to BullMQ + Redis par shift kar sakte hain — handlers same rahenge.
 */
import { Types } from "mongoose";
import { Job } from "../models/Job";
import { logger } from "../lib/logger";

export interface JobContext {
  id: string;
  tenantId: string;
  integrationId?: string;
  payload: Record<string, unknown>;
  /** Progress update (UI mein dikhta hai) */
  progress: (processed: number, message?: string) => Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export interface EnqueueOptions {
  integrationId?: string;
  payload?: Record<string, unknown>;
  delayMs?: number;
  /** Same type + integration ka queued job pehle se ho to naya mat banao */
  dedupe?: boolean;
}

export async function enqueue(tenantId: string, type: string, opts: EnqueueOptions = {}) {
  if (opts.dedupe) {
    const existing = await Job.findOne({
      tenantId,
      type,
      integrationId: opts.integrationId,
      status: { $in: ["queued", "running"] },
      ...(opts.payload ? { payload: opts.payload } : {}),
    }).lean();
    if (existing) return existing;
  }
  return Job.create({
    tenantId: new Types.ObjectId(tenantId),
    integrationId: opts.integrationId ? new Types.ObjectId(opts.integrationId) : undefined,
    type,
    payload: opts.payload ?? {},
    runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
  });
}

const STALE_MS = 15 * 60 * 1000;
const POLL_MS = 1000;
const CONCURRENCY = 3;

let running = 0;
let timer: NodeJS.Timeout | null = null;

async function claim() {
  return Job.findOneAndUpdate(
    { status: "queued", runAt: { $lte: new Date() } },
    { $set: { status: "running", lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
  );
}

async function runOne() {
  const job = await claim();
  if (!job) return false;
  const handler = handlers.get(job.type);
  const log = logger.child({ jobId: String(job._id), type: job.type });

  if (!handler) {
    await Job.updateOne({ _id: job._id }, { status: "failed", error: `No handler for ${job.type}`, finishedAt: new Date() });
    return true;
  }

  const ctx: JobContext = {
    id: String(job._id),
    tenantId: String(job.tenantId),
    integrationId: job.integrationId ? String(job.integrationId) : undefined,
    payload: (job.payload ?? {}) as Record<string, unknown>,
    progress: async (processed, message) => {
      await Job.updateOne({ _id: job._id }, { progress: { processed, message }, lockedAt: new Date() });
    },
  };

  try {
    await handler(ctx);
    await Job.updateOne({ _id: job._id }, { status: "done", finishedAt: new Date(), error: undefined });
    log.info("job done");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retry = job.attempts < job.maxAttempts && !(err instanceof NonRetryableError);
    const backoff = Math.min(60_000 * 2 ** (job.attempts - 1), 30 * 60_000);
    await Job.updateOne(
      { _id: job._id },
      retry
        ? { status: "queued", runAt: new Date(Date.now() + backoff), error: msg }
        : { status: "failed", finishedAt: new Date(), error: msg },
    );
    log.warn({ err: msg, retry }, "job failed");
  }
  return true;
}

async function tick() {
  while (running < CONCURRENCY) {
    running++;
    let got = false;
    try {
      got = await runOne();
    } catch (err) {
      logger.error({ err }, "job worker error");
    } finally {
      running--;
    }
    if (!got) break;
  }
}

export async function startWorker() {
  // crash ke baad atke hue jobs
  const r = await Job.updateMany(
    { status: "running", lockedAt: { $lt: new Date(Date.now() - STALE_MS) } },
    { $set: { status: "queued", runAt: new Date() } },
  );
  if (r.modifiedCount) logger.warn(`Requeued ${r.modifiedCount} stale jobs`);
  timer = setInterval(() => void tick(), POLL_MS);
  logger.info("⚙️  Job worker started");
}

export function stopWorker() {
  if (timer) clearInterval(timer);
}

/** Is error par retry mat karo (e.g. invalid token) */
export class NonRetryableError extends Error {}
