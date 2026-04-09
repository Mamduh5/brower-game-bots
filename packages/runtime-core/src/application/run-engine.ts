import { randomUUID } from "node:crypto";

import type { RunEvent, RunPhase, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";

import { RunLifecycle } from "./run-lifecycle.js";
import type { Clock } from "../ports/clock.js";
import { SystemClock } from "../ports/clock.js";
import type { EventPublisher } from "../ports/event-publisher.js";
import { NoopEventPublisher } from "../ports/event-publisher.js";
import type { RunRepository } from "../ports/run-repository.js";

export interface RunEngineDependencies {
  repository: RunRepository;
  clock?: Clock;
  publisher?: EventPublisher;
}

export class RunEngine {
  private readonly clock: Clock;
  private readonly publisher: EventPublisher;
  private readonly lifecycle = new RunLifecycle();

  constructor(private readonly dependencies: RunEngineDependencies) {
    this.clock = dependencies.clock ?? new SystemClock();
    this.publisher = dependencies.publisher ?? new NoopEventPublisher();
  }

  async createRun(request: RunRequest): Promise<RunRecord> {
    const run = await this.dependencies.repository.createRun(request);
    const event: RunEvent = {
      eventId: randomUUID(),
      runId: run.runId,
      sequence: 0,
      timestamp: this.clock.now().toISOString(),
      type: "run.created",
      phase: "created",
      request
    };

    await this.dependencies.repository.appendEvent(event);
    await this.publisher.publish(event);

    return run;
  }

  async transitionPhase(run: RunRecord, nextPhase: RunPhase): Promise<RunRecord> {
    const now = this.clock.now();
    const updated = this.lifecycle.transition(run, nextPhase, now);

    await this.dependencies.repository.transitionRun(updated.runId, updated.phase, updated.updatedAt);

    const event: RunEvent = {
      eventId: randomUUID(),
      runId: updated.runId,
      sequence: now.getTime(),
      timestamp: now.toISOString(),
      type: "run.phase_changed",
      phase: updated.phase
    };

    await this.dependencies.repository.appendEvent(event);
    await this.publisher.publish(event);

    return updated;
  }

  async appendEvent(event: RunEvent): Promise<void> {
    await this.dependencies.repository.appendEvent(event);
    await this.publisher.publish(event);
  }

  async saveReport(report: RunReport): Promise<void> {
    await this.dependencies.repository.saveReport(report);
  }
}
