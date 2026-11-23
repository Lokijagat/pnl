import pino from "pino";
import { isProd } from "../config/env";

export const logger = pino(
  isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } },
);
