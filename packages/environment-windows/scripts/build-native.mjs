import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "win32") throw new Error("The native desktop helper requires Windows.");
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(path.join(root, "bin"), { recursive: true });
const compiler = path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
for (const name of ["DesktopBridge", "DesktopFixture"]) {
  execFileSync(compiler, ["/nologo", name === "DesktopFixture" ? "/target:winexe" : "/target:exe", "/platform:x64", "/optimize+", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll", "/r:System.Web.Extensions.dll", `/out:${path.join(root, "bin", name + ".exe")}`, path.join(root, "native", name + ".cs"), ...(name === "DesktopBridge" ? [path.join(root, "native", "DesktopRecorder.cs")] : [])], { stdio: "inherit", windowsHide: true });
}
