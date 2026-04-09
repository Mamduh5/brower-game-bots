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

  async nextSequence(runId: string): Promise<number> {
    const events = await this.dependencies.repository.listEvents(runId);
    return events.length;
  }

  async listEvents(runId: string): Promise<readonly RunEvent[]> {
    return this.dependencies.repository.listEvents(runId);
  }

  async transitionPhase(run: RunRecord, nextPhase: RunPhase): Promise<RunRecord> {
    const now = this.clock.now();
    const updated = this.lifecycle.transition(run, nextPhase, now);
    const sequence = await this.nextSequence(updated.runId);

    await this.dependencies.repository.transitionRun(updated.runId, updated.phase, updated.updatedAt);

    const event: RunEvent = {
      eventId: randomUUID(),
      runId: updated.runId,
      sequence,
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

  async completeRun(run: RunRecord): Promise<RunRecord> {
    const updated = await this.transitionPhase(run, "completed");
    const event: RunEvent = {
      eventId: randomUUID(),
      runId: updated.runId,
      sequence: await this.nextSequence(updated.runId),
      timestamp: this.clock.now().toISOString(),
      type: "run.completed",
      phase: "completed"
    };

    await this.appendEvent(event);

    return updated;
  }

  async failRun(run: RunRecord, errorCode: string, message: string): Promise<RunRecord> {
    const updated = await this.transitionPhase(run, "failed");
    const event: RunEvent = {
      eventId: randomUUID(),
      runId: updated.runId,
      sequence: await this.nextSequence(updated.runId),
      timestamp: this.clock.now().toISOString(),
      type: "run.failed",
      phase: "failed",
      errorCode,
      message
    };

    await this.appendEvent(event);

    return updated;
  }

  async saveReport(report: RunReport): Promise<void> {
    await this.dependencies.repository.saveReport(report);
  }
}
