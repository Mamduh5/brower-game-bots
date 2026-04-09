import type { RunEvent } from "@game-bots/contracts";

export interface EventPublisher {
  publish(event: RunEvent): Promise<void>;
}

export class NoopEventPublisher implements EventPublisher {
  async publish(_event: RunEvent): Promise<void> {
    return Promise.resolve();
  }
}
