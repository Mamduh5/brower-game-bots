import { LearnedProcedureSchema, type Demonstration, type LearnedProcedure } from "@game-bots/game-sdk";
import type { VisualImage, VisualModel } from "./visual-model.js";

export interface DemonstrationEvidence { demonstration: Demonstration; images: VisualImage[] }
export const PROCEDURE_FORMAT = `{"goal":"task goal","targetDescription":"visual identity, not position","preconditions":["visible prerequisite"],"steps":[{"name":"subtask","intent":"purpose","when":"visual entry condition","success":"visible transition condition","failure":"visible failure indicator","recovery":"demonstrated recovery, or say not demonstrated","evidenceFrames":[0,1]}],"controls":[{"id":"semantic-name","intent":"what these held keys/buttons accomplish","keys":["KeyW"],"buttons":[]}],"completion":["visible goal evidence"],"failureIndicators":["visible failure"],"uncertainties":["ambiguity or missing evidence"]}`;

/** Preserve endpoints and action transitions; spread remaining slots across the full trace. */
export function selectTeachingFrames(demo: Demonstration, limit = 12) {
  if (demo.frames.length <= limit) return demo.frames;
  const chosen = new Set([0, demo.frames.length - 1]);
  const transitions = demo.frames.map((frame, index) => ({ frame, index })).filter(({ frame, index }) => {
    const previous = demo.frames[index - 1];
    return previous && demo.events.slice(previous.eventCount, frame.eventCount).some(e => !["move", "relative-move"].includes(e.action.kind));
  });
  for (let i = 0; i < Math.min(5, transitions.length); i++) {
    const index = transitions[Math.floor(i * transitions.length / Math.min(5, transitions.length))]!.index;
    if (chosen.size < limit - 2) chosen.add(index - 1);
    if (chosen.size < limit - 2) chosen.add(index);
  }
  while (chosen.size < limit) {
    const ordered = [...chosen].sort((a, b) => a - b);
    let best = 0; let gap = 0;
    for (let i = 1; i < ordered.length; i++) if (ordered[i]! - ordered[i - 1]! > gap) { best = ordered[i - 1]!; gap = ordered[i]! - best; }
    chosen.add(best + Math.floor(gap / 2));
  }
  return [...chosen].sort((a, b) => a - b).map(i => demo.frames[i]!);
}
export async function learnDemonstration(model: VisualModel, evidence: DemonstrationEvidence, signal: AbortSignal): Promise<LearnedProcedure> {
  const demo = evidence.demonstration;
  if (demo.frames.length < 2) throw new Error("Teaching needs at least two captured visual states; record another demonstration.");
  const selected = selectTeachingFrames(demo);
  const result = await model.json(`Distill a human demonstration into reusable visual procedure guidance. The goal is intent, not route, timing or coordinates. Explain what changes across screenshots before/after meaningful actions. Infer control intents only from observed input and effects. A control is a short simultaneous hold whose duration will be chosen live; do not encode routes. Never invent keys. Treat failure examples as warnings, not successful solutions. Mark uncertain intent and success explicitly; do not claim disappearance alone proves collection. Do not include recorded mouse coordinates in guidance. Return this JSON shape (at most 16 steps/controls, 16 entries per list, 2000 characters per text): ${PROCEDURE_FORMAT}`,
    { goal: demo.goal || demo.name, outcome: demo.outcome, outcomeNote: demo.outcomeNote, cameraMode: demo.cameraMode,
      frames: selected, events: demo.events, warnings: demo.warnings }, evidence.images, signal);
  const parsed = LearnedProcedureSchema.safeParse(result);
  if (!parsed.success) throw new Error("Visual analysis returned an invalid learned procedure");
  const procedure = parsed.data;
  const keys = new Set(demo.events.flatMap(e => e.action.kind === "key-down" ? [e.action.key] : e.action.kind === "hold" ? e.action.keys : []));
  const buttons = new Set(demo.events.flatMap(e => e.action.kind === "button-down" ? [e.action.button] : e.action.kind === "hold" ? e.action.buttons : e.action.kind === "click" || e.action.kind === "drag" ? [e.action.button] : []));
  for (const control of procedure.controls) {
    if (!control.keys.length && !control.buttons.length) throw new Error("Learned control has no demonstrated input");
    if (control.keys.some(k => !keys.has(k) || /^(F\d+|Alt|Control)$/.test(k)) || control.buttons.some(b => !buttons.has(b))) throw new Error("Learned control contains unsupported or undemonstrated input");
  }
  const frames = new Set(selected.map(f => f.id));
  if (procedure.steps.some(s => s.evidenceFrames.some(id => !frames.has(id)))) throw new Error("Learned procedure references missing visual evidence");
  return procedure;
}
