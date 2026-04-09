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

export class FakeEnvironmentSession implements EnvironmentSession {
  async start(_request: EnvironmentStartRequest): Promise<void> {
    return Promise.resolve();
  }

  async stop(_reason?: string): Promise<void> {
    return Promise.resolve();
  }

  async observe(request: ObservationRequest): Promise<ObservationFrame> {
    return {
      capturedAt: new Date().toISOString(),
      modes: [...request.modes],
      payload: { fake: true }
    };
  }

  async execute(_action: EnvironmentAction): Promise<ActionResult> {
    return {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      payload: {}
    };
  }

  async probeClickability(request: ClickProbeRequest): Promise<ClickProbeResult> {
    const sampleResults = request.samplePoints.map((point) => ({
      label: point.label,
      xRatio: point.xRatio,
      yRatio: point.yRatio,
      absoluteX: point.xRatio * 100,
      absoluteY: point.yRatio * 40,
      matched: true,
      clickStatus: "succeeded" as const
    }));

    return {
      probeId: request.probeId,
      surfaceSelector: request.surfaceSelector,
      ...(request.activationSelector ? { activationSelector: request.activationSelector } : {}),
      measuredAt: new Date().toISOString(),
      visibleBounds: {
        x: 0,
        y: 0,
        width: 100,
        height: 40
      },
      totalSamples: sampleResults.length,
      successfulSamples: sampleResults.length,
      successRatio: 1,
      sampleResults,
      summary: "Fake environment reported a fully clickable control."
    };
  }

  async capture(request: CaptureRequest) {
    return {
      artifactId: `artifact-${request.kind}`,
      runId: "run-fake",
      kind: request.kind,
      relativePath: `${request.kind}.txt`,
      contentType: "text/plain",
      byteLength: 0,
      createdAt: new Date().toISOString()
    };
  }

  async health(): Promise<EnvironmentHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      signals: {}
    };
  }
}

export class FakeEnvironmentPort implements EnvironmentPort {
  readonly environmentId = "fake-environment";

  async openSession(): Promise<EnvironmentSession> {
    return new FakeEnvironmentSession();
  }
}
