// Visible desktop capture and documented Win32 input only. No game/process internals.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class DesktopBridge {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct Key { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Key key; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union u; }
    delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr param);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int count);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref Point p);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int n);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flag);
    [DllImport("user32.dll", EntryPoint="OpenInputDesktop")] static extern IntPtr OpenDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);

    static readonly object Gate = new object();
    static readonly Stopwatch Clock = Stopwatch.StartNew();
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 50000000 };
    static readonly HashSet<string> Keys = new HashSet<string>();
    static readonly HashSet<string> Buttons = new HashSet<string>();
    static IntPtr Target;
    static int TargetPid;
    static string TargetStart, Geometry, Reason;
    static long Beat, Deadline, LastInput, HeldSince;
    static bool Armed, Bound, Closing, Emergency;
    static Process Parent;
    static Mutex Lease;

    static void Main(string[] args) {
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        try {
            if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) throw new Exception("Cannot enable per-monitor DPI awareness v2 (Windows 10 1703+ required).");
            Parent = Process.GetProcessById(int.Parse(args[0]));
            Beat = Clock.ElapsedMilliseconds;
            var watch = new Thread(Watch) { IsBackground = true }; watch.Start();
            string line;
            while ((line = Console.ReadLine()) != null) {
                int id = 0;
                try {
                    if (line.Length > 100000) throw new Exception("Command too large");
                    var cmd = Json.Deserialize<Dictionary<string, object>>(line);
                    id = Convert.ToInt32(cmd["id"]);
                    object result;
                    lock (Gate) { result = Dispatch(cmd); }
                    Console.WriteLine(Json.Serialize(new { id = id, ok = true, result = result }));
                    if (Closing) break;
                } catch (Exception ex) {
                    lock (Gate) { Disarm("Command failed: " + ex.Message); }
                    Console.WriteLine(Json.Serialize(new { id = id, ok = false, error = ex.Message }));
                }
            }
        } catch (Exception ex) { Console.Error.WriteLine(ex.Message); }
        finally { lock (Gate) { Disarm("Helper closed"); } if (Lease != null) { Lease.ReleaseMutex(); Lease.Dispose(); } }
    }
    static object Dispatch(Dictionary<string, object> c) {
        string op = (string)c["op"];
        if (op == "heartbeat") { Beat = Clock.ElapsedMilliseconds; return true; }
        if (op == "list") {
            var windows = new List<object>();
            EnumWindows(delegate(IntPtr h, IntPtr p) {
                try { if (IsWindowVisible(h) && !IsIconic(h)) { var w = Window(h); if ((string)w["title"] != "") windows.Add(w); } } catch { }
                return true;
            }, IntPtr.Zero);
            return windows;
        }
        if (op == "bind") {
            if (Bound) throw new Exception("Session already bound");
            var t = (Dictionary<string, object>)c["target"];
            Target = new IntPtr(long.Parse((string)t["handle"])); TargetPid = Convert.ToInt32(t["pid"]); TargetStart = (string)t["processStartedAt"];
            int limit = Convert.ToInt32(c["maxDurationMs"]);
            if (limit < 1000 || limit > 3600000) throw new Exception("Invalid native deadline");
            CheckIdentity();
            var lease = new Mutex(false, "Local\\GameBotsDesktopInput");
            bool owned = false;
            try { owned = lease.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
            if (!owned) { lease.Dispose(); throw new Exception("Another desktop run owns input"); }
            Lease = lease; Bound = true; Deadline = Clock.ElapsedMilliseconds + limit; Reason = "Paused";
            return true;
        }
        if (op == "health") return new { armed = Armed, reason = Reason, heldKeys = new List<string>(Keys), heldButtons = new List<string>(Buttons) };
        if (op == "release") { Release(); return true; }
        if (op == "pause") { Disarm("Paused"); return true; }
        if (op == "close") { Disarm("Stopped"); Closing = true; return true; }
        CheckIdentity();
        if (op == "focus") { if (Emergency) throw new Exception("F8 emergency stop is latched; start a new run"); SetForegroundWindow(Target); return true; }
        if (op == "resume") {
            if (Emergency) throw new Exception("F8 emergency stop is latched; start a new run");
            if (Clock.ElapsedMilliseconds >= Deadline) throw new Exception("Run deadline reached");
            CheckForeground();
            // Never combine physical modifiers/buttons held by the user with bot input.
            for (int vk = 1; vk < 256; vk++) if ((GetAsyncKeyState(vk) & 0x8000) != 0) throw new Exception("Release physical keys/buttons before resuming");
            Geometry = GeometryOf(); Armed = true; Reason = null; Beat = Clock.ElapsedMilliseconds; return true;
        }
        if (op == "observe") {
            CheckForeground();
            string geometry = GeometryOf();
            var w = Window(Target); var b = (Dictionary<string, object>)w["bounds"];
            int x = (int)b["x"], y = (int)b["y"], width = (int)b["width"], height = (int)b["height"];
            if ((long)width * height > 16000000) throw new Exception("Capture exceeds 16 megapixels");
            byte[] bytes;
            using (var bitmap = new Bitmap(width, height)) {
                using (var graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(x, y, 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
                using (var stream = new MemoryStream()) { bitmap.Save(stream, ImageFormat.Png); bytes = stream.ToArray(); }
            }
            CheckForeground(); if (geometry != GeometryOf()) throw new Exception("Window moved during capture");
            return new { window = w, geometry = geometry, png = Convert.ToBase64String(bytes), capturedAt = DateTime.UtcNow.ToString("o") };
        }
        if (op != "input") throw new Exception("Unknown operation");
        CheckActive();
        if ((string)c["geometry"] != GeometryOf()) throw new Exception("Stale observation geometry");
        if (Clock.ElapsedMilliseconds - LastInput < 5) throw new Exception("Native input rate exceeded");
        LastInput = Clock.ElapsedMilliseconds;
        string kind = (string)c["kind"];
        if (kind == "move") {
            var p = (Dictionary<string, object>)c["point"]; Move(Convert.ToDouble(p["x"]), Convert.ToDouble(p["y"]));
        } else if (kind == "relative-move") {
            CheckPointer(); int dx = Convert.ToInt32(c["dx"]), dy = Convert.ToInt32(c["dy"]);
            if (Math.Abs(dx) > 1000 || Math.Abs(dy) > 1000) throw new Exception("Relative motion exceeds limit");
            MouseInput(1, dx, dy, 0);
        } else if (kind == "scroll") {
            CheckPointer(); int ticks = Convert.ToInt32(c["ticks"]); if (Math.Abs(ticks) > 20) throw new Exception("Scroll exceeds limit");
            MouseInput((string)c["axis"] == "horizontal" ? 0x1000u : 0x800u, 0, 0, unchecked((uint)(ticks * 120)));
        } else if (kind == "key-down" || kind == "key-up") {
            string key = (string)c["key"]; KeyCode(key);
            if (kind == "key-down") {
                CheckHotkey(key); if (!Keys.Contains(key)) { MarkHeld(); Keys.Add(key); KeyInput(key, false); }
            } else if (Keys.Contains(key)) { KeyInput(key, true); Keys.Remove(key); }
        } else if (kind == "button-down" || kind == "button-up") {
            string button = (string)c["button"]; ButtonFlag(button, false);
            if (kind == "button-down") { CheckPointer(); if (!Buttons.Contains(button)) { MarkHeld(); Buttons.Add(button); MouseInput(ButtonFlag(button, false), 0, 0, 0); } }
            else if (Buttons.Contains(button)) { MouseInput(ButtonFlag(button, true), 0, 0, 0); Buttons.Remove(button); }
        } else throw new Exception("Unsupported primitive input");
        return true;
    }
    static Dictionary<string, object> Window(IntPtr h) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        using (var process = Process.GetProcessById((int)pid)) {
            var title = new StringBuilder(2048); GetWindowText(h, title, title.Capacity);
            Rect r; Point p = new Point();
            if (!GetClientRect(h, out r) || !ClientToScreen(h, ref p) || r.Right <= 0 || r.Bottom <= 0) throw new Exception("Window has no client area");
            return new Dictionary<string, object> {
                { "handle", h.ToInt64().ToString() }, { "pid", (int)pid }, { "processStartedAt", process.StartTime.ToUniversalTime().Ticks.ToString() },
                { "processName", process.ProcessName }, { "title", title.ToString() }, { "dpi", (int)GetDpiForWindow(h) },
                { "bounds", new Dictionary<string, object> { { "x", p.X }, { "y", p.Y }, { "width", r.Right }, { "height", r.Bottom } } }
            };
        }
    }
    static string GeometryOf() {
        var w = Window(Target); var b = (Dictionary<string, object>)w["bounds"];
        return b["x"] + ":" + b["y"] + ":" + b["width"] + ":" + b["height"] + ":" + w["dpi"];
    }
    static void CheckIdentity() {
        if (!IsWindow(Target) || !IsWindowVisible(Target) || IsIconic(Target)) throw new Exception("Target window lost, hidden, or minimized");
        var w = Window(Target);
        if ((int)w["pid"] != TargetPid || (string)w["processStartedAt"] != TargetStart) throw new Exception("Target identity changed");
    }
    static void CheckForeground() {
        CheckIdentity();
        if (GetForegroundWindow() != Target) throw new Exception("Target focus lost");
        IntPtr desktop = OpenDesktop(0, false, 0x0100);
        if (desktop == IntPtr.Zero) throw new Exception("Interactive desktop unavailable");
        CloseDesktop(desktop);
    }
    static void CheckActive() {
        if (!Armed) throw new Exception(Reason ?? "Input is not armed");
        if ((GetAsyncKeyState(0x77) & 0x8000) != 0) { Emergency = true; throw new Exception("F8 emergency stop"); }
        CheckForeground();
        if (((GetAsyncKeyState(16) & 0x8000) != 0 && !Keys.Contains("Shift")) || ((GetAsyncKeyState(17) & 0x8000) != 0 && !Keys.Contains("Control")) || ((GetAsyncKeyState(18) & 0x8000) != 0 && !Keys.Contains("Alt")) || ((GetAsyncKeyState(91) & 0x8000) != 0) || ((GetAsyncKeyState(92) & 0x8000) != 0)) throw new Exception("Unowned physical modifier pressed; input stopped");
        if (Clock.ElapsedMilliseconds >= Deadline) throw new Exception("Run deadline reached");
        if (Clock.ElapsedMilliseconds - Beat > 2500) throw new Exception("Controller heartbeat expired");
        if (Geometry != GeometryOf()) throw new Exception("Window geometry changed; observe and resume");
    }
    static void CheckPointer() {
        Point p; if (!GetCursorPos(out p)) throw new Exception("Cursor unavailable");
        var b = (Dictionary<string, object>)Window(Target)["bounds"];
        if (p.X < (int)b["x"] || p.X >= (int)b["x"] + (int)b["width"] || p.Y < (int)b["y"] || p.Y >= (int)b["y"] + (int)b["height"] || GetAncestor(WindowFromPoint(p), 2) != Target) throw new Exception("Pointer is outside target or target point is occluded");
    }
    static void Move(double x, double y) {
        if (double.IsNaN(x) || double.IsNaN(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new Exception("Invalid client coordinate");
        var b = (Dictionary<string, object>)Window(Target)["bounds"];
        int sx = (int)b["x"] + (int)Math.Round(x * ((int)b["width"] - 1)), sy = (int)b["y"] + (int)Math.Round(y * ((int)b["height"] - 1));
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        if (sx < vx || sy < vy || sx >= vx + vw || sy >= vy + vh) throw new Exception("Target coordinate is off screen");
        Point p = new Point { X = sx, Y = sy };
        if (GetAncestor(WindowFromPoint(p), 2) != Target) throw new Exception("Target point is occluded");
        MouseInput(0xC001, (int)Math.Round((sx - vx) * 65535.0 / (vw - 1)), (int)Math.Round((sy - vy) * 65535.0 / (vh - 1)), 0);
    }
    static void MarkHeld() { if (Keys.Count + Buttons.Count == 0) HeldSince = Clock.ElapsedMilliseconds; }
    static void CheckHotkey(string added) {
        var k = new HashSet<string>(Keys); k.Add(added);
        if ((k.Contains("Alt") && (k.Contains("F4") || k.Contains("Tab") || k.Contains("Escape") || k.Contains("Space"))) || (k.Contains("Control") && (k.Contains("Escape") || (k.Contains("Alt") && k.Contains("Delete")) || (k.Contains("Shift") && k.Contains("Escape"))))) throw new Exception("Operating-system hotkey is not allowed");
    }
    static ushort KeyCode(string k) {
        if (k.Length == 4 && k.StartsWith("Key") && k[3] >= 'A' && k[3] <= 'Z') return k[3];
        if (k.Length == 6 && k.StartsWith("Digit") && k[5] >= '0' && k[5] <= '9') return k[5];
        int f; if (k.StartsWith("F") && int.TryParse(k.Substring(1), out f) && f >= 1 && f <= 12 && f != 8) return (ushort)(111 + f);
        switch(k) {
            case "Space": return 32; case "Enter": return 13; case "Tab": return 9; case "Escape": return 27; case "Backspace": return 8; case "Delete": return 46;
            case "ArrowLeft": return 37; case "ArrowUp": return 38; case "ArrowRight": return 39; case "ArrowDown": return 40;
            case "Shift": return 160; case "Control": return 162; case "Alt": return 164;
            case "Home": return 36; case "End": return 35; case "PageUp": return 33; case "PageDown": return 34;
            default: throw new Exception("Unsupported key " + k);
        }
    }
    static uint ButtonFlag(string b, bool up) { switch(b) { case "left": return up ? 4u : 2u; case "right": return up ? 16u : 8u; case "middle": return up ? 64u : 32u; default: throw new Exception("Unsupported button"); } }
    static void KeyInput(string k, bool up) {
        ushort vk = KeyCode(k); bool extended = vk >= 33 && vk <= 46;
        Send(new Input { type = 1, u = new Union { key = new Key { scan = (ushort)MapVirtualKey(vk, 0), flags = 8u | (up ? 2u : 0u) | (extended ? 1u : 0u) } } });
    }
    static void MouseInput(uint flags, int dx, int dy, uint data) { Send(new Input { type = 0, u = new Union { mouse = new Mouse { flags = flags, dx = dx, dy = dy, data = data } } }); }
    static void Send(Input input) { if (SendInput(1, new Input[] { input }, Marshal.SizeOf(typeof(Input))) != 1) throw new Exception("SendInput failed (permissions or input desktop); Win32=" + Marshal.GetLastWin32Error()); }
    static void Release() {
        var errors = new List<string>();
        foreach (string k in new List<string>(Keys)) try { KeyInput(k, true); Keys.Remove(k); } catch (Exception e) { errors.Add(e.Message); }
        foreach (string b in new List<string>(Buttons)) try { MouseInput(ButtonFlag(b, true), 0, 0, 0); Buttons.Remove(b); } catch (Exception e) { errors.Add(e.Message); }
        if (errors.Count > 0) Reason = "Input release failed; will retry: " + string.Join("; ", errors);
    }
    static void Disarm(string reason) { Armed = false; Reason = reason; Release(); }
    static void Watch() {
        while (!Closing) {
            Thread.Sleep(20);
            lock (Gate) {
              try {
                if (Parent.HasExited) { Disarm("Controller process exited"); Environment.Exit(0); }
                if ((GetAsyncKeyState(0x77) & 0x8000) != 0) { Emergency = true; Disarm("F8 emergency stop"); }
                if (Armed) try {
                    CheckActive();
                    if (Keys.Count + Buttons.Count > 0 && Clock.ElapsedMilliseconds - HeldSince > 5500) throw new Exception("Held input exceeded 5.5 seconds");
                } catch (Exception e) { Disarm(e.Message); }
                else if (Keys.Count + Buttons.Count > 0) Release();
              } catch (Exception e) { Disarm("Watchdog failed: " + e.Message); }
            }
        }
    }
}
