import type { Page } from "playwright";

export interface NetworkEntry {
  url: string;
  method: string;
}

export class NetworkStreamCollector {
  private readonly entries: NetworkEntry[] = [];

  attach(page: Page): void {
    page.on("request", (request) => {
      this.entries.push({
        url: request.url(),
        method: request.method()
      });
    });
  }

  snapshot(): readonly NetworkEntry[] {
    return [...this.entries];
  }
}
