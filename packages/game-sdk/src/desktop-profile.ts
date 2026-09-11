import { z } from "zod";
import { DesktopActionSchema, DesktopWindowSchema } from "@game-bots/environment-sdk";

export const DesktopSkillSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().max(300),
  actions: z.array(DesktopActionSchema).min(1).max(32)
}).strict();
export const DesktopProfileSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(80),
  mode: z.enum(["automation", "feedback"]).default("automation"),
  goal: z.string().max(2000).default(""),
  intervalMs: z.number().int().min(100).max(60000).default(1000),
  startDelayMs: z.number().int().min(0).max(60000).default(3000),
  maxActions: z.number().int().min(1).max(10000).default(100),
  maxDurationMs: z.number().int().min(1000).max(3600000).default(60000),
  maxUnchangedObservations: z.number().int().min(0).max(100).default(0),
  actions: z.array(DesktopActionSchema).min(1).max(128),
  skills: z.array(DesktopSkillSchema).max(32).default([])
}).strict().superRefine((profile, ctx) => {
  if (new Set(profile.skills.map(s => s.id)).size !== profile.skills.length) ctx.addIssue({ code: "custom", message: "Skill ids must be unique" });
  if (profile.startDelayMs >= profile.maxDurationMs) ctx.addIssue({ code: "custom", message: "Start delay must be shorter than run duration" });
});
export type DesktopProfile = z.infer<typeof DesktopProfileSchema>;
export const DesktopRunRequestSchema = z.object({ target: DesktopWindowSchema, profile: DesktopProfileSchema }).strict();
