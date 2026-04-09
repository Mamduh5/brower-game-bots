import type { Finding, ReproStep } from "@game-bots/contracts";

export class ReproBuilder {
  build(finding: Finding): readonly ReproStep[] {
    return finding.reproSteps;
  }
}
