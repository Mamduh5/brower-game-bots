// Isolated controller used only by the owned-fixture smoke test.
import { WindowsDesktopSession } from "../packages/environment-windows/dist/index.js";
import { setTimeout as wait } from "node:timers/promises";
const [mode, serialized] = process.argv.slice(2);
const session = new WindowsDesktopSession();
try {
  await session.bind(JSON.parse(serialized), mode === "deadline" ? 1500 : 15000);
  await session.resume();
  const observation = await session.observe(); const signal = new AbortController().signal;
  await session.execute({ kind: "move", point: { x: .5, y: .5 } }, observation.geometry, signal);
  await session.execute({ kind: "key-down", key: "KeyW" }, observation.geometry, signal);
  await session.execute({ kind: "button-down", button: "left" }, observation.geometry, signal);
  process.stdout.write("ARMED\n");
  if (mode === "crash") await new Promise(() => {});
  if (mode === "stall") { const end = Date.now() + 3500; while (Date.now() < end) { /* Deliberately stall this test controller. */ } }
  if (mode === "hold-limit") await wait(6000);
  if (mode === "deadline") await wait(1800);
  process.stdout.write(JSON.stringify(await session.health()) + "\n");
} finally { await session.close(); }
