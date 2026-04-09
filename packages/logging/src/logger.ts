import pino, { type Logger, type LoggerOptions } from "pino";

import { DEFAULT_REDACT_PATHS } from "./redaction.js";

export interface CreateLoggerOptions {
  level?: LoggerOptions["level"];
  base?: Record<string, string>;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino({
    level: options.level ?? "info",
    base: options.base ?? null,
    redact: {
      paths: [...DEFAULT_REDACT_PATHS],
      censor: "[REDACTED]"
    }
  });
}
