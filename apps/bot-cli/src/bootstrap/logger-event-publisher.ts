import type { RunEvent } from "@game-bots/contracts";
import type { EventPublisher } from "@game-bots/runtime-core";

interface InfoLogger {
  info(payload: object, message: string): void;
}

export class LoggerEventPublisher implements EventPublisher {
  constructor(private readonly logger: InfoLogger) {}

  async publish(event: RunEvent): Promise<void> {
    this.logger.info(
      {
        runId: event.runId,
        eventType: event.type,
        sequence: event.sequence
      },
      "Run event published."
    );
  }
}
