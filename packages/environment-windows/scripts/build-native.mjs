import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "win32") throw new Error("The native desktop helper requires Windows.");
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
mkdirSync(path.join(root, "bin"), { recursive: true });
const compiler = path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
// Compile before interrupting any existing bridge; never compile over a loaded image.
const staging = mkdtempSync(path.join(root, "bin", ".native-build-"));
try {
  for (const name of ["DesktopBridge", "DesktopFixture"]) {
    execFileSync(compiler, ["/nologo", name === "DesktopFixture" ? "/target:winexe" : "/target:exe", "/platform:x64", "/optimize+", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll", "/r:System.Web.Extensions.dll", `/out:${path.join(staging, name + ".exe")}`, path.join(root, "native", name + ".cs"), ...(name === "DesktopBridge" ? ["DesktopRecorder.cs", "DesktopTimeline.cs", "DesktopMacroCapture.cs"].map(file => path.join(root, "native", file)) : [])], { stdio: "inherit", windowsHide: true });
  }
  const destination = path.join(root, "bin", "DesktopBridge.exe");
  for (let attempt = 0; ; attempt++) {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "stop-owned-bridge.ps1"), "-ExecutablePath", destination], { stdio: "inherit", windowsHide: true });
    try { renameSync(path.join(staging, "DesktopBridge.exe"), destination); break; }
    catch (error) {
      if (attempt >= 2 || !["EBUSY", "EPERM", "EACCES"].includes(error.code)) {
        throw new Error("Could not replace this repository's DesktopBridge.exe. Stop its active desktop session and retry desktop:setup.", { cause: error });
      }
    }
  }
  // The fixture is interactive: do not terminate it as part of bridge recovery.
  try { renameSync(path.join(staging, "DesktopFixture.exe"), path.join(root, "bin", "DesktopFixture.exe")); }
  catch (error) { throw new Error("Could not replace DesktopFixture.exe. Close the desktop fixture window and retry desktop:setup.", { cause: error }); }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
