import { z } from "zod";

import { JsonObjectSchema } from "@game-bots/contracts";

export const ObservationModeSchema = z.enum([
  "dom",
  "screenshot",
  "accessibility",
  "console",
  "network",
  "heartbeat"
]);
export type ObservationMode = z.infer<typeof ObservationModeSchema>;

export const ObservationRequestSchema = z.object({
  modes: z.array(ObservationModeSchema).min(1),
  correlationId: z.string().min(1).optional(),
  runtimeProbe: z
    .object({
      id: z.string().min(1),
      script: z.string().min(1)
    })
    .optional()
});
export type ObservationRequest = z.infer<typeof ObservationRequestSchema>;

export const ObservationFrameSchema = z.object({
  capturedAt: z.string().datetime(),
  modes: z.array(ObservationModeSchema).min(1),
  summary: z.string().optional(),
  payload: JsonObjectSchema
});
export type ObservationFrame = z.infer<typeof ObservationFrameSchema>;
