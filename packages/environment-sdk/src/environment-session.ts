import { z } from "zod";

import { ArtifactRefSchema, RunIdSchema } from "@game-bots/contracts";

import type { ActionResult, EnvironmentAction } from "./action.js";
import type { ClickProbeRequest, ClickProbeResult } from "./click-probe.js";
import type { EnvironmentHealth } from "./health.js";
import type { ObservationFrame, ObservationRequest } from "./observation.js";

export const EnvironmentStartRequestSchema = z.object({
  runId: RunIdSchema,
  headless: z.boolean().default(true),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .optional()
});
export type EnvironmentStartRequest = z.infer<typeof EnvironmentStartRequestSchema>;

export const CaptureRequestSchema = z.object({
  kind: z.enum(["screenshot", "trace", "video", "dom-snapshot", "log", "json"]),
  name: z.string().min(1).optional()
});
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export interface EnvironmentSession {
  start(request: EnvironmentStartRequest): Promise<void>;
  stop(reason?: string): Promise<void>;
  observe(request: ObservationRequest): Promise<ObservationFrame>;
  execute(action: EnvironmentAction): Promise<ActionResult>;
  probeClickability(request: ClickProbeRequest): Promise<ClickProbeResult>;
  capture(request: CaptureRequest): Promise<z.infer<typeof ArtifactRefSchema>>;
  health(): Promise<EnvironmentHealth>;
}

export interface EnvironmentPort {
  readonly environmentId: string;
  openSession(): Promise<EnvironmentSession>;
}
