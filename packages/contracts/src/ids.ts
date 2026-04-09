import { z } from "zod";

const IdPattern = /^[a-zA-Z0-9._:-]+$/;

export const IdentifierSchema = z
  .string()
  .min(1)
  .regex(IdPattern, "Identifier contains unsupported characters.");

export const RunIdSchema = IdentifierSchema;
export const EventIdSchema = IdentifierSchema;
export const ArtifactIdSchema = IdentifierSchema;
export const FindingIdSchema = IdentifierSchema;
export const ReportIdSchema = IdentifierSchema;
export const StepIdSchema = IdentifierSchema;
export const ScenarioIdSchema = IdentifierSchema;
export const GameIdSchema = IdentifierSchema;
export const EnvironmentIdSchema = IdentifierSchema;
export const ProfileIdSchema = IdentifierSchema;

export type Identifier = z.infer<typeof IdentifierSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type FindingId = z.infer<typeof FindingIdSchema>;
export type ReportId = z.infer<typeof ReportIdSchema>;
export type StepId = z.infer<typeof StepIdSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type GameId = z.infer<typeof GameIdSchema>;
export type EnvironmentId = z.infer<typeof EnvironmentIdSchema>;
export type ProfileId = z.infer<typeof ProfileIdSchema>;
