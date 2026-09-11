import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const child = spawn(fileURLToPath(new URL("../packages/environment-windows/bin/DesktopFixture.exe", import.meta.url)), [], { stdio: "inherit", windowsHide: false });
child.on("error", error => { console.error("Run pnpm desktop:setup first.", error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
