import { z } from "zod";

const RelativeCoordinateSchema = z.number().min(0).max(1);

export const ClickProbeSamplePointSchema = z.object({
  label: z.string().min(1),
  xRatio: RelativeCoordinateSchema,
  yRatio: RelativeCoordinateSchema
});
export type ClickProbeSamplePoint = z.infer<typeof ClickProbeSamplePointSchema>;

export const DEFAULT_CLICK_PROBE_SAMPLE_POINTS: readonly ClickProbeSamplePoint[] = [
  { label: "top-left", xRatio: 0.1, yRatio: 0.1 },
  { label: "top-center", xRatio: 0.5, yRatio: 0.1 },
  { label: "top-right", xRatio: 0.9, yRatio: 0.1 },
  { label: "center-left", xRatio: 0.1, yRatio: 0.5 },
  { label: "center", xRatio: 0.5, yRatio: 0.5 },
  { label: "center-right", xRatio: 0.9, yRatio: 0.5 },
  { label: "bottom-left", xRatio: 0.1, yRatio: 0.9 },
  { label: "bottom-center", xRatio: 0.5, yRatio: 0.9 },
  { label: "bottom-right", xRatio: 0.9, yRatio: 0.9 }
] as const;

export const ClickProbeRequestSchema = z.object({
  probeId: z.string().min(1),
  surfaceSelector: z.string().min(1),
  activationSelector: z.string().min(1).optional(),
  samplePoints: z.array(ClickProbeSamplePointSchema).min(1).default([...DEFAULT_CLICK_PROBE_SAMPLE_POINTS])
});
export type ClickProbeRequest = z.infer<typeof ClickProbeRequestSchema>;

export const ClickProbeBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
});
export type ClickProbeBounds = z.infer<typeof ClickProbeBoundsSchema>;

export const ClickProbeSampleResultSchema = z.object({
  label: z.string().min(1),
  xRatio: RelativeCoordinateSchema,
  yRatio: RelativeCoordinateSchema,
  absoluteX: z.number(),
  absoluteY: z.number(),
  matched: z.boolean(),
  clickStatus: z.enum(["succeeded", "missed", "failed"]),
  detail: z.string().optional()
});
export type ClickProbeSampleResult = z.infer<typeof ClickProbeSampleResultSchema>;

export const ClickProbeResultSchema = z.object({
  probeId: z.string().min(1),
  surfaceSelector: z.string().min(1),
  activationSelector: z.string().min(1).optional(),
  measuredAt: z.string().datetime(),
  visibleBounds: ClickProbeBoundsSchema.optional(),
  totalSamples: z.number().int().nonnegative(),
  successfulSamples: z.number().int().nonnegative(),
  successRatio: z.number().min(0).max(1),
  sampleResults: z.array(ClickProbeSampleResultSchema),
  summary: z.string().min(1)
});
export type ClickProbeResult = z.infer<typeof ClickProbeResultSchema>;
