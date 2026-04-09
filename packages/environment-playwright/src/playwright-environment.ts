import { Buffer } from "node:buffer";

import type { JsonObject } from "@game-bots/contracts";
import type {
  ActionResult,
  CaptureRequest,
  EnvironmentAction,
  EnvironmentHealth,
  EnvironmentPort,
  EnvironmentSession,
  EnvironmentStartRequest,
  ObservationFrame,
  ObservationRequest
} from "@game-bots/environment-sdk";
import type { ArtifactStore } from "@game-bots/runtime-core";

import { PlaywrightBrowserSession, type PlaywrightBrowserSessionOptions } from "./browser-session.js";
import { ConsoleStreamCollector } from "./capture/console-stream.js";
import { captureDomSnapshot } from "./capture/dom-snapshot.js";
import { NetworkStreamCollector } from "./capture/network-stream.js";
import { captureScreenshot } from "./capture/screenshot-capture.js";

export interface PlaywrightEnvironmentOptions {
  artifactStore: ArtifactStore;
  browser?: PlaywrightBrowserSession;
  browserOptions?: PlaywrightBrowserSessionOptions;
  environmentId?: string;
}

class PlaywrightEnvironmentSession implements EnvironmentSession {
  private readonly consoleCollector = new ConsoleStreamCollector();
  private readonly networkCollector = new NetworkStreamCollector();
  private runId: string | null = null;
  private started = false;

  constructor(
    private readonly browser: PlaywrightBrowserSession,
    private readonly artifactStore: ArtifactStore,
    private readonly browserOptions?: PlaywrightBrowserSessionOptions
  ) {}

  async start(request: EnvironmentStartRequest): Promise<void> {
    const startOptions: PlaywrightBrowserSessionOptions = {
      ...(this.browserOptions?.launchOptions
        ? {
            launchOptions: {
              ...this.browserOptions.launchOptions,
              headless: request.headless
            }
          }
        : {
            launchOptions: {
              headless: request.headless
            }
          })
    };

    const viewport = request.viewport ?? this.browserOptions?.viewport;
    if (viewport) {
      startOptions.viewport = viewport;
    }

    await this.browser.start(startOptions);

    const page = this.browser.getPage();
    this.consoleCollector.attach(page);
    this.networkCollector.attach(page);
    this.runId = request.runId;
    this.started = true;
  }

  async stop(_reason?: string): Promise<void> {
    await this.browser.stop();
    this.started = false;
    this.runId = null;
  }

  async observe(request: ObservationRequest): Promise<ObservationFrame> {
    const page = this.browser.getPage();
    const payload: JsonObject = {
      url: page.url(),
      title: await page.title(),
      modes: [...request.modes]
    };

    if (request.modes.includes("console")) {
      payload.console = this.consoleCollector.snapshot().map((entry) => ({ ...entry }));
    }

    if (request.modes.includes("network")) {
      payload.network = this.networkCollector.snapshot().map((entry) => ({ ...entry }));
    }

    if (request.modes.includes("dom")) {
      payload.domAvailable = true;
    }

    return {
      capturedAt: new Date().toISOString(),
      modes: [...request.modes],
      payload,
      summary: "Playwright observation captured."
    };
  }

  async execute(action: EnvironmentAction): Promise<ActionResult> {
    const page = this.browser.getPage();

    switch (action.kind) {
      case "click":
        await page.locator(action.target.selector).click();
        break;
      case "type":
        await page.locator(action.target.selector).fill(action.text);
        break;
      case "keypress":
        await page.keyboard.press(action.key);
        break;
      case "navigate":
        await page.goto(action.url);
        break;
      case "wait":
        await page.waitForTimeout(action.durationMs);
        break;
      case "scroll":
        await page.mouse.wheel(0, action.deltaY);
        break;
    }

    return {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      payload: {}
    };
  }

  async capture(request: CaptureRequest) {
    if (!this.runId) {
      throw new Error("Environment capture requires an active run.");
    }

    const page = this.browser.getPage();

    switch (request.kind) {
      case "screenshot":
        return captureScreenshot(page, this.artifactStore, this.runId, request.name);
      case "dom-snapshot":
        return captureDomSnapshot(page, this.artifactStore, this.runId, request.name);
      case "json":
        return this.artifactStore.put(
          {
            runId: this.runId,
            kind: "json",
            relativePath: `captures/${request.name ?? "capture"}.json`,
            contentType: "application/json"
          },
          Buffer.from(JSON.stringify(await this.observe({ modes: ["heartbeat"] }), null, 2), "utf8")
        );
      default:
        throw new Error(`Capture kind ${request.kind} is not implemented in Phase 1.`);
    }
  }

  async health(): Promise<EnvironmentHealth> {
    return {
      status: this.started ? "healthy" : "degraded",
      checkedAt: new Date().toISOString(),
      detail: this.started ? "Browser session active." : "Browser session not started.",
      signals: {}
    };
  }
}

export class PlaywrightEnvironmentPort implements EnvironmentPort {
  readonly environmentId: string;

  constructor(private readonly options: PlaywrightEnvironmentOptions) {
    this.environmentId = options.environmentId ?? "playwright-browser";
  }

  async openSession(): Promise<EnvironmentSession> {
    return new PlaywrightEnvironmentSession(
      this.options.browser ?? new PlaywrightBrowserSession(),
      this.options.artifactStore,
      this.options.browserOptions
    );
  }
}
