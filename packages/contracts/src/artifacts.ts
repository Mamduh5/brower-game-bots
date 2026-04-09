import { z } from "zod";

import { ArtifactIdSchema, EventIdSchema, RunIdSchema } from "./ids.js";

export const ArtifactKindSchema = z.enum([
  "screenshot",
  "trace",
  "video",
  "log",
  "dom-snapshot",
  "network-log",
  "report",
  "json"
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactRefSchema = z.object({
  artifactId: ArtifactIdSchema,
  runId: RunIdSchema,
  kind: ArtifactKindSchema,
  relativePath: z.string().min(1),
  contentType: z.string().min(1),
  byteLength: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime()
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const EvidenceRefSchema = z.object({
  artifactId: ArtifactIdSchema.optional(),
  eventId: EventIdSchema.optional(),
  label: z.string().min(1),
  detail: z.string().optional()
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
