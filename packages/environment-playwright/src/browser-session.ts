import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from "playwright";

export interface PlaywrightBrowserSessionOptions {
  launchOptions?: LaunchOptions;
  viewport?: {
    width: number;
    height: number;
  };
}

export class PlaywrightBrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async start(options: PlaywrightBrowserSessionOptions = {}): Promise<void> {
    this.browser = await chromium.launch(options.launchOptions);
    this.context = await this.browser.newContext(
      options.viewport
        ? {
            viewport: options.viewport
          }
        : undefined
    );
    this.page = await this.context.newPage();
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error("Playwright page is not available before session start.");
    }

    return this.page;
  }

  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error("Playwright browser context is not available before session start.");
    }

    return this.context;
  }

  async stop(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
