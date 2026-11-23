import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { authRouter } from "./routes/auth";
import { integrationsRouter } from "./routes/integrations";
import { marketingRouter } from "./routes/marketing";
import { teamRouter } from "./routes/team";
import { productsRouter } from "./routes/products";
import { ordersRouter } from "./routes/orders";
import { settingsRouter } from "./routes/settings";
import { webhooksRouter } from "./routes/webhooks";
import { reportsRouter } from "./routes/reports";
import { shipmentsRouter } from "./routes/shipments";
import { marketingReportRouter } from "./routes/marketingReport";
import { errorHandler } from "./middleware/error";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  // Webhooks: raw body (HMAC) — express.json() se PEHLE
  app.use("/api/webhooks", webhooksRouter);

  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/marketing", marketingRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/reports", marketingReportRouter);
  app.use("/api/shipments", shipmentsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });
  app.use(errorHandler);
  return app;
}
