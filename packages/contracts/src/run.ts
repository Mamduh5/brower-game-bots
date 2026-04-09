import { z } from "zod";

import {
  EnvironmentIdSchema,
  GameIdSchema,
  ProfileIdSchema,
  RunIdSchema,
  ScenarioIdSchema
} from "./ids.js";
import { JsonObjectSchema } from "./json.js";

export const AgentKindSchema = z.enum(["tester", "player"]);
export type AgentKind = z.infer<typeof AgentKindSchema>;

export const RunPhaseSchema = z.enum([
  "created",
  "preparing",
  "environment_starting",
  "game_bootstrap",
  "executing",
  "evaluating",
  "reporting",
  "completed",
  "failed",
  "cancelled"
]);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RunStatusSchema = z.enum(["active", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunRequestSchema = z.object({
  agentKind: AgentKindSchema,
  gameId: GameIdSchema,
  environmentId: EnvironmentIdSchema,
  profileId: ProfileIdSchema.optional(),
  scenarioId: ScenarioIdSchema.optional(),
  goal: JsonObjectSchema.optional(),
  config: JsonObjectSchema.default({})
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const RunRecordSchema = z.object({
  runId: RunIdSchema,
  agentKind: AgentKindSchema,
  gameId: GameIdSchema,
  environmentId: EnvironmentIdSchema,
  profileId: ProfileIdSchema.optional(),
  scenarioId: ScenarioIdSchema.optional(),
  phase: RunPhaseSchema,
  status: RunStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  config: JsonObjectSchema
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
