import { Schema, model, type InferSchemaType } from "mongoose";
import { JOB_STATUSES } from "@pnl/shared";

/** MongoDB-backed background job queue */
const jobSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration" },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: JOB_STATUSES, default: "queued" },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    runAt: { type: Date, default: () => new Date() },
    lockedAt: Date,
    finishedAt: Date,
    progress: { processed: { type: Number, default: 0 }, message: String },
    error: String,
  },
  { timestamps: true },
);

jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ tenantId: 1, integrationId: 1, createdAt: -1 });
// purane done jobs 30 din baad auto delete
jobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export type JobDoc = InferSchemaType<typeof jobSchema>;
export const Job = model("Job", jobSchema);

const webhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration", required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    topic: String,
    /** provider ka event id — duplicate delivery ignore */
    eventId: { type: String, required: true },
    resourceId: String,
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);
webhookEventSchema.index({ integrationId: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

export const WebhookEvent = model("WebhookEvent", webhookEventSchema);
