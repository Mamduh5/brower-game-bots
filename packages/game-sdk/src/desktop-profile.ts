import { z } from "zod";
import { DesktopActionSchema, DesktopWindowSchema } from "@game-bots/environment-sdk";
import { LearnedRunOptionsSchema } from "./teaching.js";
import { LocalRunOptionsSchema } from "./local-learning.js";
import { MacroEvidenceSchema } from "./macro.js";

// Preserve the existing action objects; timing/editor metadata are optional additions.
export const DesktopSequenceActionSchema = z.object({
  delayBeforeMs: z.number().min(0).max(120000).optional(), enabled: z.boolean().optional()
}).passthrough().transform((value, context) => {
  const { delayBeforeMs, enabled, ...raw } = value;
  const result = DesktopActionSchema.safeParse(raw);
  if (!result.success) { for (const issue of result.error.issues) context.addIssue(issue); return z.NEVER; }
  return { ...result.data, ...(delayBeforeMs === undefined ? {} : { delayBeforeMs }), ...(enabled === undefined ? {} : { enabled }) };
});
export type DesktopSequenceAction = z.infer<typeof DesktopSequenceActionSchema>;
export const DesktopLoopSchema = z.object({ mode: z.enum(["once", "count", "until-stopped"]), count: z.number().int().min(1).max(10000).default(1), delayMs: z.number().int().min(0).max(60000).default(0) }).strict();

export const DesktopSkillSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().max(300),
  actions: z.array(DesktopActionSchema).min(1).max(32)
}).strict();
export const DesktopProfileSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(80),
  mode: z.enum(["automation", "feedback", "local"]).default("automation"),
  goal: z.string().max(2000).default(""),
  learnedBehaviorId: z.string().uuid().optional(),
  policyTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  learnedOptions: LearnedRunOptionsSchema.optional(),
  localOptions: LocalRunOptionsSchema.optional(),
  intervalMs: z.number().int().min(100).max(60000).default(1000),
  startDelayMs: z.number().int().min(0).max(60000).default(3000),
  maxActions: z.number().int().min(1).max(1000000).default(100),
  maxDurationMs: z.number().int().min(1000).max(86400000).default(60000),
  maxUnchangedObservations: z.number().int().min(0).max(100).default(0),
  actions: z.array(DesktopSequenceActionSchema).min(1).max(10000),
  macro: MacroEvidenceSchema.optional(),
  playback: z.enum(["interval", "recorded"]).default("interval"),
  loop: DesktopLoopSchema.optional(),
  maxHoldMs: z.number().int().min(5500).max(60000).default(5500),
  skills: z.array(DesktopSkillSchema).max(32).default([])
}).strict().superRefine((profile, ctx) => {
  if (profile.mode !== "local" && (profile.maxActions > 10000 || profile.maxDurationMs > 3600000)) ctx.addIssue({ code: "custom", message: "Macro and AI runs retain the 10,000 action / one hour limit" });
  if (new Set(profile.skills.map(s => s.id)).size !== profile.skills.length) ctx.addIssue({ code: "custom", message: "Skill ids must be unique" });
  if (profile.startDelayMs >= profile.maxDurationMs) ctx.addIssue({ code: "custom", message: "Start delay must be shorter than run duration" });
  if (profile.actions.every(a => a.enabled === false)) ctx.addIssue({ code: "custom", message: "Enable at least one action" });
});
export type DesktopProfile = z.infer<typeof DesktopProfileSchema>;
export const DesktopRunRequestSchema = z.object({ target: DesktopWindowSchema, profile: DesktopProfileSchema }).strict();
