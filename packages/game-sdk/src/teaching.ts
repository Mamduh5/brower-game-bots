import { z } from "zod";
import { DesktopKeySchema, DesktopButtonSchema, DesktopWindowSchema, RecordedEventSchema } from "@game-bots/environment-sdk";

export const TeachingIdSchema = z.string().uuid();
const text = z.string().trim().min(1).max(2000);
const notes = z.array(text).max(16);
export const TeachingStartSchema = z.object({
  behaviorId: TeachingIdSchema.optional(), name: z.string().trim().min(1).max(80),
  goal: z.string().trim().max(2000).default(""),
  cameraMode: z.enum(["pointer", "relative"]).default("pointer")
}).strict();
export const TeachingFrameSchema = z.object({
  id: z.number().int().nonnegative(), atMs: z.number().nonnegative(), capturedAt: z.string(),
  eventCount: z.number().int().nonnegative(), geometry: z.string(), sha256: z.string(),
  file: z.string().regex(/^frames\/\d+\.png$/),
  heldKeys: z.array(DesktopKeySchema), heldButtons: z.array(DesktopButtonSchema)
}).strict();
export const DemonstrationSchema = z.object({
  version: z.literal(1), id: TeachingIdSchema, behaviorId: TeachingIdSchema,
  name: z.string(), goal: z.string(), cameraMode: z.enum(["pointer", "relative"]),
  target: DesktopWindowSchema, createdAt: z.string(), endedAt: z.string(),
  outcome: z.enum(["success", "failure", "uncertain"]), outcomeNote: z.string().max(2000),
  captureReason: z.string(), frames: z.array(TeachingFrameSchema).max(160),
  events: z.array(RecordedEventSchema).max(2100), warnings: z.array(z.string()).max(20)
}).strict();
export type Demonstration = z.infer<typeof DemonstrationSchema>;
export type TeachingFrame = z.infer<typeof TeachingFrameSchema>;

// Semantic names are inferred per behavior. No generated code or replay coordinates.
export const LearnedControlSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,48}$/), intent: text,
  keys: z.array(DesktopKeySchema).max(4), buttons: z.array(DesktopButtonSchema).max(2)
}).strict();
export const LearnedProcedureSchema = z.object({
  goal: text, targetDescription: text, preconditions: notes,
  steps: z.array(z.object({ name: text, intent: text, when: text, success: text, failure: text, recovery: text,
    evidenceFrames: z.array(z.number().int().nonnegative()).min(1).max(12) }).strict()).min(1).max(16),
  controls: z.array(LearnedControlSchema).max(16),
  completion: notes.min(1), failureIndicators: notes, uncertainties: notes
}).strict().superRefine((value, ctx) => {
  if (new Set(value.controls.map(c => c.id)).size !== value.controls.length) ctx.addIssue({ code: "custom", message: "Control names must be unique" });
});
export type LearnedProcedure = z.infer<typeof LearnedProcedureSchema>;
export const LearnedExampleSchema = z.object({
  demonstrationId: TeachingIdSchema, outcome: z.enum(["success", "failure", "uncertain"]),
  procedure: LearnedProcedureSchema.nullable(), analyzedAt: z.string().nullable(),
  model: z.string().nullable(), provider: z.string().nullable()
}).strict();
export const LearnedBehaviorSchema = z.object({
  version: z.literal(1), id: TeachingIdSchema, name: z.string().trim().min(1).max(80), goal: z.string().max(2000),
  processName: z.string(), cameraMode: z.enum(["pointer", "relative"]),
  completionOverride: z.string().max(2000).default(""), reviewed: z.boolean().default(false),
  examples: z.array(LearnedExampleSchema).max(100), updatedAt: z.string()
}).strict();
export type LearnedBehavior = z.infer<typeof LearnedBehaviorSchema>;
export const TeachingOutcomeSchema = z.object({ outcome: z.enum(["success", "failure", "uncertain"]), outcomeNote: z.string().max(2000).default("") }).strict();
export const BehaviorReviewSchema = z.object({ id: TeachingIdSchema, goal: text, completionOverride: text, reviewed: z.literal(true) }).strict();
export const LearnedRunOptionsSchema = z.object({
  maxCalls: z.number().int().min(2).max(200).default(30),
  maxNoProgress: z.number().int().min(2).max(10).default(4),
  maxRecoveries: z.number().int().min(0).max(5).default(2),
  maxActionMs: z.number().int().min(100).max(2000).default(750),
  maxObservationAgeMs: z.number().int().min(1000).max(60000).default(15000)
}).strict();
export type LearnedRunOptions = z.infer<typeof LearnedRunOptionsSchema>;
