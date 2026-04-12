import { Buffer } from "node:buffer";

import type { JsonObject, JsonValue } from "@game-bots/contracts";
import type {
  ActionResult,
  CaptureRequest,
  ClickProbeRequest,
  ClickProbeResult,
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
      payload.domHtml = await page.content();
    }

    if (request.modes.includes("screenshot")) {
      const canvasLocator = page.locator("canvas").first();
      const canvasCount = await page.locator("canvas").count();
      payload.primaryCanvasAvailable = canvasCount > 0;

      if (canvasCount > 0) {
        try {
          const canvasBuffer = Buffer.from(await canvasLocator.screenshot());
          const bounds = await canvasLocator.boundingBox();
          payload.primaryCanvasPngBase64 = canvasBuffer.toString("base64");
          if (bounds) {
            payload.primaryCanvasBounds = {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height
            };
          }
        } catch (error) {
          payload.primaryCanvasCaptureError =
            error instanceof Error ? error.message : "Primary canvas capture failed.";
        }
      }
    }

    if (request.runtimeProbe) {
      try {
        const runtimeProbeValue = await page.evaluate(async ({ script }) => {
          const evaluator = new Function(script) as () => unknown;
          return await evaluator();
        }, {
          script: request.runtimeProbe.script
        });

        payload.runtimeProbe = {
          id: request.runtimeProbe.id,
          value: (runtimeProbeValue ?? null) as JsonValue
        };
      } catch (error) {
        payload.runtimeProbe = {
          id: request.runtimeProbe.id,
          error: error instanceof Error ? error.message : "Runtime probe evaluation failed."
        };
      }
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

  async probeClickability(request: ClickProbeRequest): Promise<ClickProbeResult> {
    const page = this.browser.getPage();
    const surfaceLocator = page.locator(request.surfaceSelector);
    const bounds = await surfaceLocator.boundingBox();

    if (!bounds) {
      return {
        probeId: request.probeId,
        surfaceSelector: request.surfaceSelector,
        ...(request.activationSelector ? { activationSelector: request.activationSelector } : {}),
        measuredAt: new Date().toISOString(),
        totalSamples: request.samplePoints.length,
        successfulSamples: 0,
        successRatio: 0,
        sampleResults: request.samplePoints.map((point) => ({
          label: point.label,
          xRatio: point.xRatio,
          yRatio: point.yRatio,
          absoluteX: 0,
          absoluteY: 0,
          matched: false,
          clickStatus: "failed",
          detail: `Surface selector '${request.surfaceSelector}' was not visible.`
        })),
        summary: `Surface selector '${request.surfaceSelector}' was not visible for click probing.`
      };
    }

    const sampleResults = [];
    let successfulSamples = 0;

    for (const point of request.samplePoints) {
      const absoluteX = bounds.x + bounds.width * point.xRatio;
      const absoluteY = bounds.y + bounds.height * point.yRatio;
      const hitTarget = await page.evaluate(
        ({ x, y, surfaceSelector, activationSelector }) => {
          const node = document.elementFromPoint(x, y);
          if (!(node instanceof Element)) {
            return false;
          }

          const selector = activationSelector ?? surfaceSelector;
          return Boolean(node.matches(selector) || node.closest(selector));
        },
        {
          x: absoluteX,
          y: absoluteY,
          surfaceSelector: request.surfaceSelector,
          activationSelector: request.activationSelector
        }
      );

      if (!hitTarget) {
        sampleResults.push({
          label: point.label,
          xRatio: point.xRatio,
          yRatio: point.yRatio,
          absoluteX,
          absoluteY,
          matched: false,
          clickStatus: "missed" as const,
          detail: "Sample point did not resolve to the clickable target."
        });
        continue;
      }

      try {
        await page.mouse.click(absoluteX, absoluteY);
        successfulSamples += 1;
        sampleResults.push({
          label: point.label,
          xRatio: point.xRatio,
          yRatio: point.yRatio,
          absoluteX,
          absoluteY,
          matched: true,
          clickStatus: "succeeded" as const,
          detail: "Sample point resolved to the clickable target and the click completed."
        });
      } catch (error) {
        sampleResults.push({
          label: point.label,
          xRatio: point.xRatio,
          yRatio: point.yRatio,
          absoluteX,
          absoluteY,
          matched: true,
          clickStatus: "failed" as const,
          detail: error instanceof Error ? error.message : "Click attempt failed."
        });
      }
    }

    return {
      probeId: request.probeId,
      surfaceSelector: request.surfaceSelector,
      ...(request.activationSelector ? { activationSelector: request.activationSelector } : {}),
      measuredAt: new Date().toISOString(),
      visibleBounds: bounds,
      totalSamples: request.samplePoints.length,
      successfulSamples,
      successRatio: request.samplePoints.length === 0 ? 0 : successfulSamples / request.samplePoints.length,
      sampleResults,
      summary: `Clickable samples: ${successfulSamples}/${request.samplePoints.length} within the visible control bounds.`
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
