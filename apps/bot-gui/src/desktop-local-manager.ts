import { z } from "zod";
import { LocalTrainSchema, TeachingIdSchema, type LocalTrainRequest } from "@game-bots/game-sdk";
import { LocalWorker } from "@game-bots/agent-player";
import { DesktopBehaviorStore } from "./desktop-teaching-manager.js";

const RequestSchema = z.object({
  behaviorId: TeachingIdSchema,
  action: z.enum(["inspect", "train", "reset-demonstrations", "full-reset", "clear-runtime", "forget-demo", "forget-transition", "correct"]),
  training: LocalTrainSchema.optional(), id: z.string().max(100).optional(), outcome: z.enum(["success", "failure", "wrong-state"]).optional()
}).strict();
/** Called under the recording manager's operation lease; cannot race input or AI analysis. */
export class DesktopLocalManager {
  constructor(private readonly root: string, private readonly createWorker = () => new LocalWorker()) {}
  async operation(raw: unknown) {
    const request = RequestSchema.parse(raw), store = new DesktopBehaviorStore(this.root), behavior = await store.get(request.behaviorId);
    const worker = this.createWorker();
    try {
      const initialized = await worker.call("init", { root: this.root, behavior, reset: request.action === "reset-demonstrations" ? "demonstrations" : request.action === "full-reset" });
      if (request.action === "inspect") return await worker.call("inspect");
      if (["train", "reset-demonstrations", "full-reset"].includes(request.action)) {
        const training = request.training ?? LocalTrainSchema.parse({ behaviorId: behavior.id });
        if (training.behaviorId !== behavior.id) throw new Error("Training belongs to a different behavior");
        if (training.demonstrationId && !behavior.examples.some(e => e.demonstrationId === training.demonstrationId)) throw new Error("Demonstration does not belong to this behavior");
        const annotations: LocalTrainRequest[] = request.action === "full-reset" ? [] : training.demonstrationId ? [training] : behavior.examples.map(e => {
          const previous = request.action === "reset-demonstrations" ? initialized.savedAnnotations?.find((a: { id: string }) => a.id === e.demonstrationId)?.annotation : undefined;
          return LocalTrainSchema.parse(previous ?? { ...training, demonstrationId: e.demonstrationId, outcome: e.outcome });
        });
        const result = await worker.call("train", { annotations });
        return result;
      }
      return await worker.call("edit", { action: request.action, ...(request.id ? { id: request.id } : {}), ...(request.outcome ? { outcome: request.outcome } : {}) });
    } finally { await worker.close(); }
  }
}
