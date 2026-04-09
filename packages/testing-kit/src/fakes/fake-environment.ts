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
