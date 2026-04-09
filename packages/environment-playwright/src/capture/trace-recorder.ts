import type { BrowserContext } from "playwright";

export class TraceRecorder {
  async start(context: BrowserContext): Promise<void> {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  async stop(context: BrowserContext, path: string): Promise<void> {
    await context.tracing.stop({ path });
  }
}
