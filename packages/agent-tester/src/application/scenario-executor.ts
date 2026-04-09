import type { TestScenario } from "@game-bots/game-sdk";

import type { TestPlan } from "../domain/test-plan.js";

export class ScenarioExecutor {
  async execute(plan: TestPlan, availableScenarios: readonly TestScenario[]): Promise<TestScenario> {
    if (availableScenarios.length === 0) {
      throw new Error("Tester scenario execution requires at least one scenario.");
    }

    if (plan.scenarioId) {
      const selected = availableScenarios.find((scenario) => scenario.scenarioId === plan.scenarioId);

      if (!selected) {
        throw new Error(`Scenario '${plan.scenarioId}' is not available for the selected game.`);
      }

      return selected;
    }

    const [firstScenario] = availableScenarios;
    if (!firstScenario) {
      throw new Error("No scenario could be selected.");
    }

    return firstScenario;
  }
}
