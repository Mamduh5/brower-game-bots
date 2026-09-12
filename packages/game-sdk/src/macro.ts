import { z } from "zod";
import { RecordedEventSchema } from "@game-bots/environment-sdk";

export const MacroFeatureSchema = z.object({ x: z.number().min(0).max(160), y: z.number().min(0).max(120), descriptor: z.array(z.number().min(-4).max(4)).length(49), persistence: z.number().int().min(1).max(160) }).strict();
export const MacroFrameSchema = z.object({ atMs: z.number().min(0).max(120000), eventCount: z.number().int().min(0).max(10000),
  neutral: z.boolean(), features: z.array(MacroFeatureSchema).max(96), image: z.string().max(120000), sha256: z.string().length(64)
}).strict();
/** Additive, independently versioned evidence. The editable actions remain compatible with v1 profiles. */
export const MacroEvidenceSchema = z.object({ version: z.literal(1), visualCorrection: z.boolean(),
  source: z.array(RecordedEventSchema).min(1).max(10000), frames: z.array(MacroFrameSchema).max(160),
  width: z.number().int().positive(), height: z.number().int().positive()
}).strict().superRefine((value, ctx) => {
  for (const list of [value.source, value.frames]) for (let i = 1; i < list.length; i++) if (list[i]!.atMs < list[i - 1]!.atMs) ctx.addIssue({ code: "custom", message: "Macro evidence timestamps must be ordered" });
  if (value.frames.reduce((n, f) => n + f.image.length, 0) > 8 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "Macro image budget exceeded" });
  if (value.frames.some(f => f.eventCount > value.source.length)) ctx.addIssue({ code: "custom", message: "Macro checkpoint exceeds input stream" });
});
export type MacroEvidence = z.infer<typeof MacroEvidenceSchema>;
export type MacroFrame = z.infer<typeof MacroFrameSchema>;
export type MacroFeature = z.infer<typeof MacroFeatureSchema>;
