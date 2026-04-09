import type { Page } from "playwright";

export interface ConsoleEntry {
  type: string;
  text: string;
}

export class ConsoleStreamCollector {
  private readonly entries: ConsoleEntry[] = [];

  attach(page: Page): void {
    page.on("console", (message) => {
      this.entries.push({
        type: message.type(),
        text: message.text()
      });
    });
  }

  snapshot(): readonly ConsoleEntry[] {
    return [...this.entries];
  }
}
