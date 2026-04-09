import type { EnvironmentPort } from "@game-bots/environment-sdk";

export async function assertEnvironmentPortContract(port: EnvironmentPort): Promise<void> {
  const session = await port.openSession();
  await session.start({ runId: "run-contract", headless: true });
  await session.observe({ modes: ["heartbeat"] });
  await session.health();
  await session.stop("contract-check");
}
