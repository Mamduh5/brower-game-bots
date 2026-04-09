import type { TestPlan } from "../domain/test-plan.js";

export class ScenarioExecutor {
  async execute(plan: TestPlan): Promise<TestPlan> {
    return plan;
  }
}
