import crypto from "node:crypto";
import express, { Router } from "express";
import { Integration } from "../models/Integration";
import { WebhookEvent } from "../models/Job";
import { decrypt } from "../lib/crypto";
import { enqueue } from "../jobs/queue";
import { JOB_TYPES } from "../jobs/handlers";
import { logger } from "../lib/logger";
import { Shipment } from "../models/Shipment";
import { mapShiprocketStatus } from "../integrations/courier/shiprocket";
import { parseIstDate } from "../integrations/courier/common";

/**
 * Raw body chahiye (HMAC) — isliye app.ts mein express.json() se PEHLE mount hota hai.
 * Rule: jaldi 200 do, kaam job queue mein.
 */
export const webhooksRouter = Router();
webhooksRouter.use(express.raw({ type: "*/*", limit: "5mb" }));

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Courier webhooks: /api/webhooks/courier/:key
 * (Shiprocket URL mein "shiprocket"/"sr"/"kr" words allow nahi karta — isliye generic path)
 */
webhooksRouter.post("/courier/:key", async (req, res) => {
  const integ = await Integration.findOne({ webhookKey: req.params.key, category: "shipping" }).select("+secrets").lean<{
    _id: unknown;
    tenantId: unknown;
    provider: string;
    secrets?: Record<string, string>;
  }>();
  if (!integ) {
    res.status(404).end();
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    res.status(400).end();
    return;
  }

  if (integ.provider === "shiprocket") {
    const expected = integ.secrets?.webhookToken ? decrypt(integ.secrets.webhookToken) : "";
    const got = req.get("x-api-key") ?? "";
    if (!expected || !safeEqual(expected, got)) {
      res.status(401).end();
      return;
    }
    const awb = String(body.awb ?? "").trim();
    const statusRaw = String(body.current_status ?? body.shipment_status ?? "");
    if (awb && statusRaw) {
      const eventId = `${awb}:${statusRaw}:${body.current_timestamp ?? ""}`;
      try {
        await WebhookEvent.create({ provider: "shiprocket", integrationId: integ._id, tenantId: integ.tenantId, topic: "tracking", eventId, resourceId: awb });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          res.status(200).json({ ok: true });
          return;
        }
        throw err;
      }
      const status = mapShiprocketStatus(statusRaw);
      const at = parseIstDate(body.current_timestamp) ?? new Date();
      const set: Record<string, unknown> = { status, statusRaw, lastStatusAt: at };
      if (status === "delivered") set.deliveredAt = at;
      if (status === "rto_initiated") set.rtoInitiatedAt = at;
      if (status === "rto_delivered") set.rtoDeliveredAt = at;
      if (body.courier_name) set.courierName = String(body.courier_name);

      const s = await Shipment.findOneAndUpdate({ tenantId: integ.tenantId, provider: "shiprocket", awb }, { $set: set }, { new: true }).lean();
      const tenantId = String(integ.tenantId);
      if (s?.orderId) {
        await enqueue(tenantId, JOB_TYPES.courierRollup, { payload: { orderIds: [String(s.orderId)] } });
      }
      if (!s || status.startsWith("rto")) {
        // naya shipment ya RTO → charges ke liye sync (RTO charges aate hain)
        await enqueue(tenantId, JOB_TYPES.courierSync, { integrationId: String(integ._id), dedupe: true, delayMs: 60_000 });
      }
    }
    // Shiprocket 200 expect karta hai
    res.status(200).json({ ok: true });
    return;
  }

  logger.info({ provider: integ.provider }, "Courier webhook received (no handler yet)");
  res.status(200).json({ ok: true });
});

webhooksRouter.post("/shopify/:key", async (req, res) => {
  const integ = await Integration.findOne({ webhookKey: req.params.key, provider: "shopify" }).select("+secrets").lean<{
    _id: unknown;
    tenantId: unknown;
    secrets?: Record<string, string>;
  }>();
  if (!integ) {
    res.status(404).end();
    return;
  }

  const secretEnc = integ.secrets?.apiSecretKey;
  const hmac = req.get("X-Shopify-Hmac-Sha256") ?? "";
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!secretEnc) {
    res.status(401).end();
    return;
  }
  const digest = crypto.createHmac("sha256", decrypt(secretEnc)).update(raw).digest("base64");
  if (!safeEqual(digest, hmac)) {
    logger.warn({ integrationId: String(integ._id) }, "Shopify webhook HMAC mismatch");
    res.status(401).end();
    return;
  }

  const topic = req.get("X-Shopify-Topic") ?? "";
  const eventId = req.get("X-Shopify-Webhook-Id") ?? req.get("X-Shopify-Event-Id") ?? crypto.createHash("sha1").update(raw).digest("hex");
  const tenantId = String(integ.tenantId);
  const integrationId = String(integ._id);

  let payload: { admin_graphql_api_id?: string; order_id?: number } = {};
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    /* ignore */
  }

  try {
    await WebhookEvent.create({ provider: "shopify", integrationId: integ._id, tenantId: integ.tenantId, topic, eventId, resourceId: payload.admin_graphql_api_id });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res.status(200).end(); // duplicate delivery
      return;
    }
    throw err;
  }

  const gid = payload.admin_graphql_api_id;
  switch (topic) {
    case "orders/create":
    case "orders/updated":
    case "orders/cancelled":
      if (gid) await enqueue(tenantId, JOB_TYPES.shopifyOrderRefresh, { integrationId, payload: { gid }, dedupe: true });
      break;
    case "refunds/create":
      if (payload.order_id)
        await enqueue(tenantId, JOB_TYPES.shopifyOrderRefresh, {
          integrationId,
          payload: { gid: `gid://shopify/Order/${payload.order_id}` },
          dedupe: true,
        });
      break;
    case "products/create":
    case "products/update":
      if (gid) await enqueue(tenantId, JOB_TYPES.shopifyProductRefresh, { integrationId, payload: { gid }, dedupe: true });
      break;
    case "products/delete":
      if (gid) await enqueue(tenantId, JOB_TYPES.shopifyProductDelete, { integrationId, payload: { gid } });
      break;
    case "app/uninstalled":
      await Integration.updateOne({ _id: integ._id }, { status: "error", lastError: "Shopify app uninstall ho gaya — naya token daalo" });
      break;
    default:
      logger.info({ topic }, "Unhandled Shopify webhook topic");
  }
  res.status(200).end();
});
