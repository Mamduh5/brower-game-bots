import { z } from "zod";

export const LoggingConfigSchema = z.object({
  level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  baseFields: z.record(z.string(), z.string()).default({})
});
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const SqliteConfigSchema = z.object({
  filename: z.string().min(1)
});
export type SqliteConfig = z.infer<typeof SqliteConfigSchema>;

export const PersistenceConfigSchema = z.object({
  sqlite: SqliteConfigSchema
});
export type PersistenceConfig = z.infer<typeof PersistenceConfigSchema>;

export const ArtifactCaptureConfigSchema = z.object({
  screenshots: z.boolean().default(true),
  traces: z.boolean().default(true),
  videos: z.boolean().default(false)
});
export type ArtifactCaptureConfig = z.infer<typeof ArtifactCaptureConfigSchema>;

export const ArtifactStorageConfigSchema = z.object({
  rootDir: z.string().min(1)
});
export type ArtifactStorageConfig = z.infer<typeof ArtifactStorageConfigSchema>;

export const RuntimeConfigSchema = z.object({
  defaultEnvironmentId: z.string().min(1),
  defaultArtifactCapture: ArtifactCaptureConfigSchema
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const AppConfigSchema = z.object({
  logging: LoggingConfigSchema,
  persistence: PersistenceConfigSchema,
  artifacts: ArtifactStorageConfigSchema,
  runtime: RuntimeConfigSchema
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
