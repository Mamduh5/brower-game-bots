import { z } from "zod";

import { ArtifactRefSchema, EvidenceRefSchema } from "./artifacts.js";
import { FindingSchema } from "./findings.js";
import { EventIdSchema, RunIdSchema, StepIdSchema } from "./ids.js";
import { JsonObjectSchema } from "./json.js";
import { RunPhaseSchema, RunRequestSchema } from "./run.js";

const BaseRunEventSchema = z.object({
  eventId: EventIdSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  stepId: StepIdSchema.optional()
});

export const RunCreatedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("run.created"),
  phase: z.literal("created"),
  request: RunRequestSchema
});

export const RunPhaseChangedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("run.phase_changed"),
  phase: RunPhaseSchema
});

export const ObservationCapturedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("observation.captured"),
  observationKind: z.string().min(1),
  summary: z.string().optional(),
  payload: JsonObjectSchema
});

export const ActionExecutedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("action.executed"),
  actionKind: z.string().min(1),
  status: z.enum(["succeeded", "failed", "skipped"]),
  summary: z.string().optional(),
  payload: JsonObjectSchema
});

export const ArtifactStoredEventSchema = BaseRunEventSchema.extend({
  type: z.literal("artifact.stored"),
  artifact: ArtifactRefSchema
});

export const EvaluationFindingEventSchema = BaseRunEventSchema.extend({
  type: z.literal("evaluation.finding_created"),
  finding: FindingSchema
});

export const ReportGeneratedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("report.generated"),
  reportId: z.string().min(1),
  evidence: z.array(EvidenceRefSchema)
});

export const RunFailedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("run.failed"),
  phase: RunPhaseSchema,
  errorCode: z.string().min(1),
  message: z.string().min(1)
});

export const RunCompletedEventSchema = BaseRunEventSchema.extend({
  type: z.literal("run.completed"),
  phase: z.literal("completed")
});

export const RunCancelledEventSchema = BaseRunEventSchema.extend({
  type: z.literal("run.cancelled"),
  phase: z.literal("cancelled"),
  reason: z.string().optional()
});

export const RunEventSchema = z.discriminatedUnion("type", [
  RunCreatedEventSchema,
  RunPhaseChangedEventSchema,
  ObservationCapturedEventSchema,
  ActionExecutedEventSchema,
  ArtifactStoredEventSchema,
  EvaluationFindingEventSchema,
  ReportGeneratedEventSchema,
  RunFailedEventSchema,
  RunCompletedEventSchema,
  RunCancelledEventSchema
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
