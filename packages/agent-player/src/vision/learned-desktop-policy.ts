import { z } from "zod";
import { DesktopPointSchema, DesktopButtonSchema, type DesktopAction, type DesktopObservation } from "@game-bots/environment-sdk";
import { LearnedBehaviorSchema, LearnedRunOptionsSchema, type LearnedBehavior, type LearnedRunOptions } from "@game-bots/game-sdk";
import type { DesktopPolicy, DesktopDecision, DesktopDecisionContext } from "../application/desktop-runner.js";
import type { VisualImage, VisualModel } from "./visual-model.js";

const ActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("control"), controlId: z.string(), durationMs: z.number().int().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("camera"), dx: z.number().int().min(-300).max(300), dy: z.number().int().min(-300).max(300), controlId: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("click"), point: DesktopPointSchema, button: DesktopButtonSchema }).strict(),
  z.object({ kind: z.literal("move"), point: DesktopPointSchema }).strict(),
  z.object({ kind: z.literal("drag"), from: DesktopPointSchema, to: DesktopPointSchema, button: DesktopButtonSchema, durationMs: z.number().int().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("scroll"), ticks: z.number().int().min(-3).max(3) }).strict(),
  z.object({ kind: z.literal("wait"), durationMs: z.number().int().min(100).max(2000) }).strict()
]);
export const VisualDecisionSchema = z.object({
  status: z.string().trim().min(1).max(300), evidence: z.string().trim().min(1).max(1500),
  progress: z.enum(["progress", "no-progress", "unknown"]),
  outcome: z.enum(["act", "recover", "complete", "stop"]), action: ActionSchema.nullable()
}).strict().refine(d => ["act", "recover"].includes(d.outcome) ? d.action !== null : d.action === null, "Action must match outcome");

/** One inference assesses progress and selects the next bounded intent. */
export class LearnedDesktopPolicy implements DesktopPolicy {
  readonly boundedBatch = true;
  readonly behavior: LearnedBehavior; readonly options: LearnedRunOptions;
  private before: DesktopObservation | undefined;
  private noProgress = 0; private recoveries = 0; private completeCandidate = false;
  private lastAction = ""; private repeated = 0;
  constructor(private readonly model: VisualModel, rawBehavior: LearnedBehavior, private readonly references: readonly VisualImage[], options: Partial<LearnedRunOptions> = {}) {
    this.behavior = LearnedBehaviorSchema.parse(rawBehavior); this.options = LearnedRunOptionsSchema.parse(options);
    if (!this.behavior.reviewed || !this.behavior.examples.some(e => e.outcome === "success" && e.procedure)) throw new Error("Review completion criteria and analyze a successful demonstration before starting this behavior");
  }
  telemetry() { return { ...this.model.usage, provider: this.model.provider, model: this.model.model, behaviorId: this.behavior.id, maxCalls: this.options.maxCalls, noProgress: this.noProgress, recoveries: this.recoveries }; }
  configuration() { return { behavior: this.behavior, options: this.options, provider: this.model.provider, model: this.model.model }; }
  reset() { this.before = undefined; this.completeCandidate = false; }
  async decide(context: DesktopDecisionContext, signal: AbortSignal): Promise<DesktopDecision> {
    if (this.model.usage.calls >= this.options.maxCalls) return { type: "stop", reason: "Model call budget reached; goal not verified" };
    const examples = [...this.behavior.examples.filter(e => e.procedure && e.outcome === "success").slice(-4), ...this.behavior.examples.filter(e => e.procedure && e.outcome !== "success").slice(-2)];
    const controls = new Map(examples.filter(e => e.outcome === "success").flatMap(e => e.procedure!.controls.map(c => [`${e.demonstrationId}:${c.id}` as string, c] as const)));
    const images: VisualImage[] = [...this.references.slice(0, 2)];
    if (this.before) images.push({ label: "BEFORE the previous bounded action (historical, not current)", png: this.before.png });
    images.push({ label: "CURRENT authoritative screenshot; ground all pointer targets here", png: context.observation.png });
    const started = Date.now();
    const raw = await this.model.json(`You control only the selected application to achieve the reviewed goal. Demonstrations are guidance; never replay their route or coordinates. Use CURRENT screenshot as truth and compare BEFORE plus action history for real task progress. Plan one short meaningful action. Re-ground points in CURRENT client image, normalized 0..1. Use learned controls by id for movement/interaction; adapt duration. Relative camera uses live deltas, never historical coordinates. If blocked or repeated input failed, try a different bounded recovery. If completion evidence is absent, do not finish. A completion claim is checked again on another observation. For continuous farming, keep searching until the reviewed stopping criterion. If the target is lost, search only if safe; otherwise stop. Return JSON with status (brief user-facing activity), evidence (visible facts, no private reasoning), progress (progress/no-progress/unknown), outcome (act/recover/complete/stop), action (null for complete/stop). Actions: {kind:"control",controlId,durationMs}; {kind:"camera",dx,dy,controlId:null or learned button control}; {kind:"click",point:{x,y},button}; {kind:"move",point:{x,y}}; {kind:"drag",from:{x,y},to:{x,y},button,durationMs}; {kind:"scroll",ticks}; {kind:"wait",durationMs}. Never output code or keyboard events.`,
      { goal: this.behavior.goal, completion: this.behavior.completionOverride, cameraMode: this.behavior.cameraMode,
        examples, controls: Object.fromEntries(controls), history: context.history.slice(-8), noProgress: this.noProgress,
        recoveriesRemaining: this.options.maxRecoveries - this.recoveries, maxActionMs: this.options.maxActionMs,
        actionsRemaining: context.actionsRemaining, confirmingCompletion: this.completeCandidate }, images, signal);
    signal.throwIfAborted();
    if (Date.now() - started > this.options.maxObservationAgeMs || Date.now() - Date.parse(context.observation.capturedAt) > this.options.maxObservationAgeMs) throw new Error("Visual decision is too old to act safely; increase the observation-age limit only for a sufficiently static task or use a faster model");
    const parsed = VisualDecisionSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Visual model returned a malformed or out-of-bounds action");
    const decision = parsed.data;
    const previous = context.history.at(-1);
    if (previous) { previous.verification = decision.progress; previous.reason = decision.evidence; }
    if (decision.outcome === "stop") return { type: "stop", reason: `${decision.status}: ${decision.evidence}` };
    if (decision.outcome === "complete") {
      if (this.completeCandidate) return { type: "complete", reason: `Goal visually verified: ${decision.evidence}` };
      this.completeCandidate = true;
      return { type: "act", reason: `Verifying completion: ${decision.evidence}`, actions: [{ kind: "wait", durationMs: 350 }] };
    }
    this.completeCandidate = false;
    if (previous && decision.progress !== "progress") this.noProgress++; else this.noProgress = 0;
    const signature = JSON.stringify(decision.action);
    this.repeated = signature === this.lastAction ? this.repeated + 1 : 1; this.lastAction = signature;
    if (this.noProgress >= this.options.maxNoProgress || this.repeated > this.options.maxNoProgress + 2) return { type: "stop", reason: "Stuck: repeated actions or unverified progress; add a corrected demonstration" };
    if (decision.outcome === "recover" && ++this.recoveries > this.options.maxRecoveries) return { type: "stop", reason: "Recovery budget exhausted; goal not verified" };
    const action = decision.action!; const actions: DesktopAction[] = [];
    if ("durationMs" in action && action.durationMs > this.options.maxActionMs) throw new Error("Visual action exceeds configured duration bound");
    const control = "controlId" in action && action.controlId ? controls.get(action.controlId) : undefined;
    if ("controlId" in action && action.controlId && !control) throw new Error("Unknown learned control");
    if (control && control.keys.some(k => /^(F\d+|Alt|Control)$/.test(k))) throw new Error("Learned control uses a reserved key");
    switch (action.kind) {
      case "control":
        if (!control) throw new Error("Unknown learned control");
        // Position inside current target before button holds, independent of physical cursor origin.
        if (control.buttons.length) actions.push({ kind: "move", point: { x: 0.5, y: 0.5 } });
        actions.push({ kind: "hold", keys: control.keys, buttons: control.buttons, durationMs: action.durationMs }); break;
      case "camera":
        if (this.behavior.cameraMode !== "relative") throw new Error("Relative camera control was not enabled for this behavior");
        if (control?.keys.length) throw new Error("Camera modifier must be a demonstrated mouse-button control");
        actions.push({ kind: "move", point: { x: 0.5, y: 0.5 } });
        for (const button of control?.buttons ?? []) actions.push({ kind: "button-down", button });
        actions.push({ kind: "relative-move", dx: action.dx, dy: action.dy }, { kind: "release-all" }); break;
      case "click": actions.push({ ...action, durationMs: 50 }); break;
      case "scroll": actions.push({ kind: "move", point: { x: 0.5, y: 0.5 } }, { ...action, axis: "vertical" }); break;
      default: actions.push(action);
    }
    if (this.behavior.cameraMode === "relative" && ["click", "move", "drag"].includes(action.kind)) throw new Error("Pointer actions require pointer mode; relative camera behavior must use controls or camera actions");
    return { type: "act", actions, reason: `${decision.status}: ${decision.evidence}` };
  }
  async verify(_context: DesktopDecisionContext, before: DesktopObservation) {
    this.before = before;
    // Assessment is combined with the next decision to avoid a second visual call per action.
    return { result: "unknown" as const, reason: "Will evaluate this action with the next current screenshot" };
  }
}
