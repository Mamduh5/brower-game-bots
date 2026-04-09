export const DEFAULT_REDACT_PATHS = [
  "config.secrets",
  "request.headers.authorization",
  "request.cookies",
  "response.headers.set-cookie"
] as const;
