// Opt-in human demonstration capture. Hooks run in this helper's message thread,
// never in a game process. Unrelated-window and injected events are not retained.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

sealed partial class DesktopRecorder : NativeWindow {
    delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct KeyboardData { public uint vk, scan, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public DesktopBridge.Point point; public uint data, flags, time; public UIntPtr extra; }
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type, Hook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out DesktopBridge.Rect r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref DesktopBridge.Point p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(DesktopBridge.Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct RawDevice { public ushort page, usage; public uint flags; public IntPtr window; }
    [StructLayout(LayoutKind.Sequential)] struct RawHeader { public uint type, size; public IntPtr device, parameter; }
    [StructLayout(LayoutKind.Explicit)] struct RawMouse {
        [FieldOffset(0)] public ushort flags; [FieldOffset(4)] public ushort buttons;
        [FieldOffset(6)] public short wheel; [FieldOffset(12)] public int dx; [FieldOffset(16)] public int dy;
    }
    [StructLayout(LayoutKind.Sequential)] struct RawKeyboard { public ushort scan, flags, reserved, vk; public uint message, extra; }
    [StructLayout(LayoutKind.Sequential)] struct CursorInfo { public int size, flags; public IntPtr cursor; public DesktopBridge.Point point; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(RawDevice[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CursorInfo info);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out DesktopBridge.Point point);

    static DesktopRecorder Instance;
    static Control Dispatcher;
    static readonly ManualResetEvent Ready = new ManualResetEvent(false);
    static Exception StartupError;
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly List<object> events = new List<object>();
    readonly List<string> commands = new List<string>();
    readonly HashSet<string> keys = new HashSet<string>();
    readonly HashSet<string> buttons = new HashSet<string>();
    readonly HashSet<uint> physicalKeys = new HashSet<uint>();
    readonly Hook keyboardCallback, mouseCallback;
    readonly System.Windows.Forms.Timer timer;
    IntPtr keyboardHook, mouseHook, target;
    Dictionary<string, object> targetInfo, hotkeys;
    string status = "idle", reason = "Recording is off", geometry;
    double accumulated, segmentStart, heldSince;
    long countdownEnd, readinessEnd;
    readonly List<string> warnings = new List<string>();
    bool captureStarted;
    int delayMs, maxDurationMs = 120000, revision;
    bool botArmed, botActive, f8Down, botPending;
    Dictionary<string, object> pendingMove;
    double pendingAt, lastMoveAt = -100;
    double lastX = -1, lastY = -1;
    Mutex lease;
    Process recordingOwner;
    RecordingHud hud;
    bool visualTeaching, teachingSession;
    bool macroVisual;
    string pointerMode = "auto";
    readonly List<object> frames = new List<object>();
    double lastFrameAt = -1000;
    long frameBytes;
    int frameCount, frameRevision = -1;
    int inputStateRevision, frameInputRevision;

    internal static object Command(Dictionary<string, object> command) {
        if (Instance == null && !Ready.WaitOne(0)) {
            var thread = new Thread(delegate() {
                try {
                    Dispatcher = new Control(); Dispatcher.CreateControl();
                    Instance = new DesktopRecorder(); Ready.Set(); Application.Run();
                } catch (Exception e) { StartupError = e; Ready.Set(); }
            }) { IsBackground = true };
            thread.SetApartmentState(ApartmentState.STA); thread.Start();
        }
        if (!Ready.WaitOne(3000)) throw new Exception("Recording message thread did not start");
        if (StartupError != null) throw new Exception("Recording helper unavailable: " + StartupError.Message);
        object result = null; Exception error = null;
        Dispatcher.Invoke((Action)delegate { try { result = Instance.Dispatch(command); } catch (Exception e) { error = e; } });
        if (error != null) throw error;
        return result;
    }
    internal static void Shutdown() {
        if (Dispatcher == null || Instance == null) return;
        Dispatcher.Invoke((Action)delegate { Instance.Stop("stopped", "Helper closed"); Instance.Unregister(); Instance.timer.Stop(); if (Instance.hud != null) Instance.hud.Dispose(); Instance.DestroyHandle(); Application.ExitThread(); });
    }
    DesktopRecorder() {
        CreateHandle(new CreateParams { Caption = "Game Bots Recording Controls", Parent = new IntPtr(-3) });
        keyboardCallback = Keyboard; mouseCallback = Mouse;
        timer = new System.Windows.Forms.Timer { Interval = 25 };
        timer.Tick += delegate { try { Tick(); } catch (Exception e) { Stop("failed", e.Message); } }; timer.Start();
    }
    object Dispatch(Dictionary<string, object> c) {
        string op = (string)c["op"];
        if (op == "recorder-frames") {
            if (!Active()) { int waits = 0; while (macroCapturing != 0 && waits++ < 500) Thread.Sleep(1); }
            lock (frames) { var batch = frames.ToArray(); frames.Clear(); return batch; }
        }
        if (op == "recorder-hotkeys") {
            if (Active() || botActive || botArmed) throw new Exception("Stop recording and disarm/stop the bot before changing hotkeys");
            var proposed = (Dictionary<string, object>)c["hotkeys"];
            var unique = new HashSet<int>();
            foreach (string name in new [] { "record", "bot", "stopRecording" }) { int vk = HotkeyCode((string)proposed[name]); if (!unique.Add(vk)) throw new Exception("Control hotkeys must be different"); }
            Unregister();
            var names = new [] { "record", "bot", "stopRecording" };
            for (int i = 0; i < names.Length; i++) {
                if (!RegisterHotKey(Handle, i + 1, 0x4000, (uint)HotkeyCode((string)proposed[names[i]]))) { int error = Marshal.GetLastWin32Error(); Unregister(); hotkeys = null; throw new Exception("Could not register " + proposed[names[i]] + "; choose another key. Win32=" + error); }
            }
            if (!RegisterHotKey(Handle, 4, 0x4000, 0x77)) { Unregister(); hotkeys = null; throw new Exception("Could not register F8 emergency shortcut; another application may own it"); }
            hotkeys = proposed; reason = "Shortcuts registered; recording and bot starts require explicit arming";
        } else if (op == "recorder-bot") {
            bool arm = Convert.ToBoolean(c["armed"]), running = Convert.ToBoolean(c["active"]);
            if ((arm || running) && Active()) throw new Exception("Stop recording before arming or starting the bot");
            botArmed = arm; botActive = running; if (!arm) botPending = false;
        } else if (op == "recorder-prepare") {
            if (botArmed || botActive || Active()) throw new Exception("Stop the current recording/bot before preparing another recording");
            if (hotkeys == null) throw new Exception("Configure recording shortcuts first");
            targetInfo = (Dictionary<string, object>)c["target"]; target = new IntPtr(long.Parse((string)targetInfo["handle"]));
            if (recordingOwner != null) recordingOwner.Dispose();
            recordingOwner = Process.GetProcessById(Convert.ToInt32(targetInfo["pid"])); var recordingHandle = recordingOwner.Handle;
            delayMs = Convert.ToInt32(c["delayMs"]); maxDurationMs = Convert.ToInt32(c["maxDurationMs"]);
            if (delayMs < 0 || delayMs > 60000 || maxDurationMs < 1000 || maxDurationMs > 120000) throw new Exception("Invalid recording limits");
            RefreshTarget();
            lease = new Mutex(false, "Local\\GameBotsDesktopInput"); bool owned;
            try { owned = lease.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
            if (!owned) { lease.Dispose(); lease = null; throw new Exception("Another recording or desktop run owns this session"); }
            events.Clear(); accumulated = 0; pendingMove = null; keys.Clear(); buttons.Clear(); physicalKeys.Clear(); lastMoveAt = -100; lastX = lastY = -1;
            visualTeaching = c.ContainsKey("visualTeaching") && Convert.ToBoolean(c["visualTeaching"]);
            teachingSession = visualTeaching;
            macroVisual = !teachingSession && c.ContainsKey("macroVisual") && Convert.ToBoolean(c["macroVisual"]);
            pointerMode = c.ContainsKey("pointerMode") ? (string)c["pointerMode"] : "auto";
            if (pointerMode != "auto" && pointerMode != "absolute" && pointerMode != "relative") throw new Exception("Invalid pointer mode");
            warnings.Clear(); captureStarted = false;
            lock (frames) { macroCaptureGeneration++; frames.Clear(); frameBytes = 0; frameCount = 0; } lastFrameAt = -1000; frameRevision = -1;
            inputStateRevision = frameInputRevision = 0;
            status = "armed"; reason = "Ready: use Start Recording or the recording hotkey"; revision++;
            UpdateHud();
        } else if (op == "recorder-start") Begin();
        else if (op == "recorder-pause") Pause("Recording paused by user");
        else if (op == "recorder-resume") { if (status != "paused") throw new Exception("Recording is not paused"); Begin(); }
        else if (op == "recorder-stop") Stop("stopped", "Recording stopped; review before replay");
        else if (op == "recorder-discard") { Stop("idle", "Recording discarded"); events.Clear(); accumulated = 0; targetInfo = null; revision++; }
        else if (op != "recorder-state") throw new Exception("Unknown recording command");
        bool include = c.ContainsKey("includeEvents") && Convert.ToBoolean(c["includeEvents"]);
        return State(include, op == "recorder-state");
    }
    bool Active() { return status == "armed" || status == "countdown" || status == "recording" || status == "paused"; }
    int HotkeyCode(string key) { int n; if (key == null || !key.StartsWith("F") || !int.TryParse(key.Substring(1), out n) || n < 1 || n > 11 || n == 8) throw new Exception("Choose F1-F11 except reserved F8"); return 111 + n; }
    bool Reserved(uint vk) { if (vk == 0x77) return true; if (hotkeys == null) return false; foreach (object v in hotkeys.Values) if (HotkeyCode((string)v) == vk) return true; return false; }
    void Unregister() { for (int id = 1; id <= 4; id++) UnregisterHotKey(Handle, id); }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x00FF && !teachingSession) try { RawInput(m.LParam); } catch (Exception e) { Stop("failed", "Raw capture failed: " + e.Message); }
        if (m.Msg == 0x0312) {
            try {
                int id = m.WParam.ToInt32();
                if (id == 4) Emergency();
                else if (id == 1) {
                    if (status == "recording") Pause("Recording paused by hotkey");
                    else if (status == "armed" || status == "paused") Begin();
                } else if (id == 3 && Active()) Stop("stopped", "Recording stopped by hotkey");
                else if (id == 2 && botArmed && !botActive && !Active()) { botArmed = false; botPending = true; }
            } catch (Exception e) { reason = e.Message; }
        }
        base.WndProc(ref m);
    }
    void Queue(string command) { if (commands.Count < 16 && !commands.Contains(command)) commands.Add(command); }
    void Emergency() { Stop("stopped", "F8 emergency stop"); botArmed = botPending = false; Queue("emergency"); }
    double Elapsed() { double value = accumulated + (status == "recording" ? clock.Elapsed.TotalMilliseconds - segmentStart : 0); return teachingSession ? Math.Floor(value) : value; }
    void Begin() {
        if (status != "armed" && status != "paused") throw new Exception("Prepare a recording or resume the paused recording first");
        if (botActive || botArmed) throw new Exception("Bot control is active");
        RefreshTarget(); SetForegroundWindow(target); countdownEnd = clock.ElapsedMilliseconds + delayMs;
        readinessEnd = countdownEnd + 10000;
        status = "countdown"; reason = "Recording countdown; release held keys/buttons before it completes"; revision++;
    }
    void Tick() {
        bool pressed = (GetAsyncKeyState(0x77) & 0x8000) != 0;
        if (pressed && !f8Down) Emergency(); f8Down = pressed;
        if (botPending && hotkeys != null && (GetAsyncKeyState(HotkeyCode((string)hotkeys["bot"])) & 0x8000) == 0) { botPending = false; Queue("bot"); }
        if (!DesktopBridge.ControllerResponsive && (Active() || botArmed)) { Stop("failed", "Controller heartbeat expired"); botArmed = false; }
        if (!Active()) return;
        try { RefreshTarget(); } catch (Exception e) { Stop("failed", e.Message); return; }
        if (status == "countdown" && clock.ElapsedMilliseconds >= countdownEnd) {
            if (clock.ElapsedMilliseconds >= readinessEnd) { Pause("Capture did not start: focus target and release controls, then resume recording"); return; }
            if (GetForegroundWindow() != target) { reason = "Waiting for target focus before capture (10 second readiness limit)"; UpdateHud(); return; }
            for (int vk = 1; vk < 256; vk++) if ((GetAsyncKeyState(vk) & 0x8000) != 0) {
                if (Reserved((uint)vk)) return; // Start key must be released before the first recorded event.
                reason = "Waiting for held key/button release before capture: " + vk; UpdateHud(); return;
            }
            CaptureFrame(); // Baseline precedes installing input hooks and starting the timeline.
            InstallHooks(); captureStarted = true; segmentStart = clock.Elapsed.TotalMilliseconds; status = "recording"; reason = visualTeaching ? "TEACHING: demonstrate your goal" : "RECORDING your input"; revision++;
        }
        if (status == "recording") {
            if (GetForegroundWindow() != target) { Pause("Target focus changed; recording paused"); return; }
            if (Elapsed() >= maxDurationMs || events.Count >= (teachingSession ? 2000 : 9900)) { Stop("stopped", "Recording duration/event limit reached"); return; }
            if (keys.Count + buttons.Count > 0 && Elapsed() - heldSince >= 59000) { Pause("Hold safety limit reached; release controls before resuming"); return; }
            if (pendingMove != null && Elapsed() - lastMoveAt >= 50) FlushMove();
            double frameInterval = teachingSession ? (revision != frameRevision ? Math.Max(350, maxDurationMs / 150) : 1000) :
                (inputStateRevision != frameInputRevision ? 150 : Math.Max(500, maxDurationMs / 140));
            if (Elapsed() - lastFrameAt >= frameInterval) CaptureFrame();
        }
        UpdateHud();
    }
    void UpdateHud() {
        if (!Active() || targetInfo == null) { if (hud != null) hud.Hide(); return; }
        if (hud == null) hud = new RecordingHud();
        var b = (Dictionary<string, object>)targetInfo["bounds"];
        hud.Location = new Point((int)b["x"] + Math.Max(0, (int)b["width"] - hud.Width - 10), (int)b["y"] + 10);
        string title = status == "countdown" ? (teachingSession ? "Teaching" : "Recording") + " starts in " + Math.Ceiling(Math.Max(0, countdownEnd - clock.ElapsedMilliseconds) / 1000.0) : status == "recording" ? (teachingSession ? "TEACHING: DEMONSTRATE YOUR GOAL" : "RECORDING YOUR INPUT") : (teachingSession ? "Teaching " : "Recording ") + status;
        hud.Caption.Text = title + "\n" + (Elapsed() / 1000) + " sec | " + events.Count + " events\n" + (hotkeys == null ? "" : hotkeys["record"] + " pause/resume | " + hotkeys["stopRecording"] + " stop | F8 emergency");
        if (!hud.Visible) hud.Show();
    }
    void RefreshTarget() {
        if (!IsWindowVisible(target) || IsIconic(target)) throw new Exception("Recording target disappeared, was hidden or minimized");
        if (status == "recording") {
            uint pid; GetWindowThreadProcessId(target, out pid);
            if (recordingOwner == null || recordingOwner.HasExited || pid != Convert.ToUInt32(targetInfo["pid"])) throw new Exception("Recording target identity changed");
            InTarget(); return;
        }
        var current = DesktopBridge.Window(target);
        if (!current["pid"].Equals(targetInfo["pid"]) || (string)current["processStartedAt"] != (string)targetInfo["processStartedAt"]) throw new Exception("Recording target identity changed");
        var b = (Dictionary<string, object>)current["bounds"];
        string next = b["x"] + ":" + b["y"] + ":" + b["width"] + ":" + b["height"] + ":" + current["dpi"];
        if (status == "recording" && geometry != next) Pause("Window geometry changed; inspect it and resume recording");
        geometry = next; targetInfo = current;
    }
    bool InTarget() {
        if (status != "recording") return false;
        if (GetForegroundWindow() != target) { Pause("Target focus changed; recording paused"); return false; }
        DesktopBridge.Rect rect; var point = new DesktopBridge.Point();
        var b = (Dictionary<string, object>)targetInfo["bounds"];
        uint pid; GetWindowThreadProcessId(target, out pid);
        if (recordingOwner == null || recordingOwner.HasExited || pid != Convert.ToUInt32(targetInfo["pid"])) { Stop("failed", "Recording target identity changed"); return false; }
        if (!GetClientRect(target, out rect) || !ClientToScreen(target, ref point) || point.X != (int)b["x"] || point.Y != (int)b["y"] || rect.Right != (int)b["width"] || rect.Bottom != (int)b["height"] || GetDpiForWindow(target) != Convert.ToUInt32(targetInfo["dpi"])) { Pause("Window geometry changed; recording paused"); return false; }
        return true;
    }
    void InstallHooks() {
        if (!teachingSession && !RegisterRawInputDevices(new [] {
            new RawDevice { page = 1, usage = 2, flags = 0x100, window = Handle },
            new RawDevice { page = 1, usage = 6, flags = 0x100, window = Handle }
        }, 2, (uint)Marshal.SizeOf(typeof(RawDevice)))) throw new Exception("Cannot register raw input");
        keyboardHook = SetWindowsHookEx(13, keyboardCallback, GetModuleHandle(null), 0);
        mouseHook = SetWindowsHookEx(14, mouseCallback, GetModuleHandle(null), 0);
        if (keyboardHook == IntPtr.Zero || mouseHook == IntPtr.Zero) { Unhook(); throw new Exception("Could not install recording hooks. Win32=" + Marshal.GetLastWin32Error()); }
    }
    void Unhook() {
        RegisterRawInputDevices(new [] { new RawDevice { page = 1, usage = 2, flags = 1 }, new RawDevice { page = 1, usage = 6, flags = 1 } }, 2, (uint)Marshal.SizeOf(typeof(RawDevice)));
        if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        keyboardHook = mouseHook = IntPtr.Zero;
    }
    void Pause(string message) {
        if (status == "recording") {
            FlushMove();
            double elapsed = Math.Min(maxDurationMs, Elapsed());
            if (!teachingSession) {
                // Freeze the input timeline before waiting for the final bounded screen copy.
                accumulated = elapsed; status = "paused"; Unhook();
                int waits = 0; while (macroCapturing != 0 && waits++ < 500) Thread.Sleep(1);
            }
            // Never capture the GUI or another app after focus loss.
            try { if (GetForegroundWindow() == target) CaptureFrame(); else if (teachingSession) Warn("Final screenshot unavailable: target lost focus"); }
            catch (Exception e) { Warn("Final teaching screenshot unavailable: " + e.Message); }
            // Keep the quiet tail before pause/stop as well as releasing recorded holds.
            Add(new Dictionary<string, object> { { "kind", "release-all" } }, elapsed);
            accumulated = elapsed;
        }
        keys.Clear(); buttons.Clear(); physicalKeys.Clear(); pendingMove = null; Unhook();
        if (Active()) status = "paused"; reason = message; revision++;
        if (teachingSession && message != "Recording stopped; review before replay" && message != "Recording stopped by hotkey") Warn(message);
    }
    void Stop(string next, string message) {
        if (Active() && !captureStarted) Warn("Capture never started. Last state: " + status + ": " + reason);
        Pause(message); status = next;
        if (hud != null) hud.Hide();
        if (lease != null) { lease.ReleaseMutex(); lease.Dispose(); lease = null; }
        if (recordingOwner != null) { recordingOwner.Dispose(); recordingOwner = null; }
    }
    void Warn(string message) { if (warnings.Count < 16 && !warnings.Contains(message)) warnings.Add(message); }
    void Add(Dictionary<string, object> action, double at) {
        if (events.Count >= (teachingSession ? 2050 : 9999)) throw new Exception("Recording event capacity reached");
        events.Add(new Dictionary<string, object> { { "atMs", Math.Max(0, Math.Min(maxDurationMs, at)) }, { "action", action } }); revision++;
        string kind = (string)action["kind"];
        if (kind.StartsWith("key-") || kind.StartsWith("button-") || kind == "release-all") inputStateRevision++;
    }
    void CaptureFrame() {
        if (!teachingSession) { CaptureMacroFrame(status != "recording"); return; }
        if ((!visualTeaching && !macroVisual) || targetInfo == null || GetForegroundWindow() != target) return;
        if (frameCount >= 158 || frameBytes >= 60 * 1024 * 1024) {
            visualTeaching = false; reason = "Teaching screenshot budget reached; stop and review captured evidence"; Warn(reason); return;
        }
        // Backpressure is temporary. A full transport queue must not disable later capture.
        if (frames.Count >= 8) { Warn("Teaching screenshot queue full; a frame was skipped"); return; }
        var before = DesktopBridge.Window(target);
        if (!before["pid"].Equals(targetInfo["pid"]) || (string)before["processStartedAt"] != (string)targetInfo["processStartedAt"]) throw new Exception("Teaching target identity changed");
        var b = (Dictionary<string, object>)before["bounds"];
        int width = (int)b["width"], height = (int)b["height"];
        if ((long)width * height > 16000000) throw new Exception("Capture exceeds 16 megapixels");
        double at = Elapsed(); byte[] bytes;
        bool showHud = hud != null && hud.Visible;
        try {
            if (showHud) hud.Hide();
            using (var bitmap = new Bitmap(width, height)) {
                using (var g = Graphics.FromImage(bitmap)) g.CopyFromScreen((int)b["x"], (int)b["y"], 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
                double scale = Math.Min(1.0, (teachingSession ? 1280.0 : 320.0) / Math.Max(width, height));
                using (var small = new Bitmap(bitmap, new Size(Math.Max(1, (int)(width * scale)), Math.Max(1, (int)(height * scale)))))
                using (var stream = new MemoryStream()) { small.Save(stream, ImageFormat.Png); bytes = stream.ToArray(); }
            }
        } finally { if (showHud) hud.Show(); }
        var after = DesktopBridge.Window(target); var ab = (Dictionary<string, object>)after["bounds"];
        if (GetForegroundWindow() != target || !after["pid"].Equals(before["pid"]) || (string)after["processStartedAt"] != (string)before["processStartedAt"]) return;
        foreach (string key in new [] { "x", "y", "width", "height" }) if (!ab[key].Equals(b[key])) return;
        if (!after["dpi"].Equals(before["dpi"])) return;
        frames.Add(new { window = before, geometry = geometry, png = Convert.ToBase64String(bytes), capturedAt = DateTime.UtcNow.ToString("o"), atMs = at, eventCount = events.Count, heldKeys = new List<string>(keys), heldButtons = new List<string>(buttons) });
        frameCount++; frameBytes += bytes.Length; lastFrameAt = at; frameRevision = revision;
    }
    void FlushMove() { if (pendingMove == null) return; Add(pendingMove, pendingAt); pendingMove = null; lastMoveAt = pendingAt; }
    void MarkHeld() { if (keys.Count + buttons.Count == 0) heldSince = Elapsed(); }
    string KeyName(uint vk) {
        if (vk >= 65 && vk <= 90) return "Key" + (char)vk;
        if (vk >= 48 && vk <= 57) return "Digit" + (char)vk;
        if (vk >= 112 && vk <= 123 && vk != 119) return "F" + (vk - 111);
        switch(vk) {
            case 16: case 160: case 161: return "Shift"; case 17: case 162: case 163: return "Control"; case 18: case 164: case 165: return "Alt";
            case 32: return "Space"; case 13: return "Enter"; case 9: return "Tab"; case 27: return "Escape"; case 8: return "Backspace"; case 46: return "Delete";
            case 37: return "ArrowLeft"; case 38: return "ArrowUp"; case 39: return "ArrowRight"; case 40: return "ArrowDown";
            case 36: return "Home"; case 35: return "End"; case 33: return "PageUp"; case 34: return "PageDown";
            default: return null;
        }
    }
    // Both keyboard and mouse packets use the same message queue and QPC receipt clock.
    // Raw hardware deltas survive cursor confinement/warping; injected device-less packets are excluded.
    void RawInput(IntPtr handle) {
        uint size = 0, headerSize = (uint)Marshal.SizeOf(typeof(RawHeader));
        if (GetRawInputData(handle, 0x10000003, IntPtr.Zero, ref size, headerSize) == uint.MaxValue || size > 4096 || size < headerSize) return;
        IntPtr memory = Marshal.AllocHGlobal((int)size);
        try {
            if (GetRawInputData(handle, 0x10000003, memory, ref size, headerSize) != size) return;
            var header = (RawHeader)Marshal.PtrToStructure(memory, typeof(RawHeader));
            if (header.device == IntPtr.Zero || !InTarget()) return;
            double at = Elapsed();
            if (events.Count >= 9900) { Stop("stopped", "Raw event budget reached (9900); record a shorter sequence"); return; }
            IntPtr body = IntPtr.Add(memory, (int)headerSize);
            if (header.type == 1) {
                var k = (RawKeyboard)Marshal.PtrToStructure(body, typeof(RawKeyboard));
                if (Reserved(k.vk)) return;
                uint physical = k.vk == 16 ? (k.scan == 0x36 ? 161u : 160u) : k.vk == 17 ? ((k.flags & 2) != 0 ? 163u : 162u) : k.vk == 18 ? ((k.flags & 2) != 0 ? 165u : 164u) : k.vk;
                string key = KeyName(physical); bool down = (k.flags & 1) == 0;
                if (key == null) { Pause("Unsupported key excluded; recording paused"); return; }
                if (down && ((keys.Contains("Alt") && (key == "Tab" || key == "F4" || key == "Space" || key == "Escape")) ||
                    (keys.Contains("Control") && (key == "Escape" || (keys.Contains("Alt") && key == "Delete"))))) {
                    Pause("System shortcut excluded; recording paused"); return;
                }
                if (down && physicalKeys.Add(physical) && !keys.Contains(key)) { MarkHeld(); keys.Add(key); Add(new Dictionary<string, object> { { "kind", "key-down" }, { "key", key } }, at); }
                else if (!down && physicalKeys.Remove(physical)) {
                    bool another = false; foreach (uint held in physicalKeys) if (KeyName(held) == key) another = true;
                    if (!another && keys.Remove(key)) Add(new Dictionary<string, object> { { "kind", "key-up" }, { "key", key } }, at);
                }
            } else if (header.type == 0) {
                var m = (RawMouse)Marshal.PtrToStructure(body, typeof(RawMouse));
                DesktopBridge.Point p; if (!GetCursorPos(out p)) throw new Exception("Cursor unavailable");
                var b = (Dictionary<string, object>)targetInfo["bounds"];
                double x = (p.X - (int)b["x"]) / (double)Math.Max(1, (int)b["width"] - 1), y = (p.Y - (int)b["y"]) / (double)Math.Max(1, (int)b["height"] - 1);
                if (x < 0 || x > 1 || y < 0 || y > 1) { Pause("Pointer left the target"); return; }
                var cursor = new CursorInfo { size = Marshal.SizeOf(typeof(CursorInfo)) };
                bool hidden = GetCursorInfo(ref cursor) && (cursor.flags & 1) == 0;
                bool relative = pointerMode == "relative" || (pointerMode == "auto" && (hidden || buttons.Contains("right") || (m.buttons & 4) != 0));
                if (relative && (m.flags & 1) != 0) { Pause("Absolute raw device cannot supply relative camera motion; choose absolute pointer capture"); return; }
                if ((m.buttons & 0x3C0) != 0) { Pause("Unsupported extra mouse button"); return; }
                // Establish click position before a button edge, never warp during a camera hold.
                if (!relative && (x != lastX || y != lastY || m.dx != 0 || m.dy != 0)) {
                    Add(new Dictionary<string, object> { { "kind", "move" }, { "point", new Dictionary<string, object> { { "x", x }, { "y", y } } } }, at);
                    ((Dictionary<string, object>)events[events.Count - 1])["rawMouse"] = new { dx = m.dx, dy = m.dy, relative = false, x = x, y = y };
                    lastX = x; lastY = y;
                }
                string[] names = { "left", "right", "middle" };
                for (int i = 0; i < 3; i++) if ((m.buttons & (1 << (i * 2))) != 0 && !buttons.Contains(names[i])) {
                    MarkHeld(); buttons.Add(names[i]); Add(new Dictionary<string, object> { { "kind", "button-down" }, { "button", names[i] } }, at);
                }
                if (relative && (m.dx != 0 || m.dy != 0)) {
                    if (Math.Abs((long)m.dx) > 1000 || Math.Abs((long)m.dy) > 1000) { Pause("Raw mouse packet exceeds safe replay bounds"); return; }
                    Add(new Dictionary<string, object> { { "kind", "relative-move" }, { "dx", m.dx }, { "dy", m.dy } }, at);
                    ((Dictionary<string, object>)events[events.Count - 1])["rawMouse"] = new { dx = m.dx, dy = m.dy, relative = true, x = x, y = y };
                    lastX = lastY = -1;
                }
                for (int i = 0; i < 3; i++) if ((m.buttons & (2 << (i * 2))) != 0 && buttons.Remove(names[i]))
                    Add(new Dictionary<string, object> { { "kind", "button-up" }, { "button", names[i] } }, at);
                if ((m.buttons & 0xC00) != 0) {
                    if (Math.Abs((int)m.wheel) > 2400) { Pause("Wheel packet exceeds replay bounds"); return; }
                    Add(new Dictionary<string, object> { { "kind", "scroll" }, { "ticks", m.wheel / 120.0 }, { "axis", (m.buttons & 0x800) != 0 ? "horizontal" : "vertical" } }, at);
                }
            }
        } finally { Marshal.FreeHGlobal(memory); }
    }
    IntPtr Keyboard(int code, IntPtr message, IntPtr data) {
        if (code >= 0) try {
            var input = (KeyboardData)Marshal.PtrToStructure(data, typeof(KeyboardData));
            if (teachingSession && (input.flags & 0x12) == 0 && !Reserved(input.vk) && InTarget()) {
                bool down = message.ToInt32() == 0x100 || message.ToInt32() == 0x104;
                string key = KeyName(input.vk);
                if (key == null) Pause("Unsupported key excluded; recording paused (Unicode/IME/Windows keys are not replayable)");
                else if (down && ((keys.Contains("Alt") && (key == "Tab" || key == "F4" || key == "Space" || key == "Escape")) || (keys.Contains("Control") && (key == "Escape" || (keys.Contains("Alt") && key == "Delete"))))) {
                    while (events.Count > 0) { var ev = (Dictionary<string, object>)events[events.Count - 1]; var a = (Dictionary<string, object>)ev["action"]; if ((string)a["kind"] == "key-down" && Array.IndexOf(new [] { "Alt", "Control", "Shift" }, (string)a["key"]) >= 0) events.RemoveAt(events.Count - 1); else break; }
                    Pause("System shortcut excluded; recording paused");
                } else {
                    FlushMove();
                    if (down) { if (physicalKeys.Add(input.vk) && !keys.Contains(key)) { MarkHeld(); keys.Add(key); Add(new Dictionary<string, object> { { "kind", "key-down" }, { "key", key } }, Elapsed()); } }
                    else if (physicalKeys.Remove(input.vk)) {
                        bool stillDown = false; foreach (uint held in physicalKeys) if (KeyName(held) == key) stillDown = true;
                        if (!stillDown && keys.Remove(key)) Add(new Dictionary<string, object> { { "kind", "key-up" }, { "key", key } }, Elapsed());
                    }
                }
            }
        } catch (Exception e) { Stop("failed", "Keyboard recording failed: " + e.Message); }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    IntPtr Mouse(int code, IntPtr message, IntPtr data) {
        if (code >= 0) try {
            var input = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
            if (teachingSession && (input.flags & 3) == 0 && InTarget()) {
                var b = (Dictionary<string, object>)targetInfo["bounds"]; int x = input.point.X - (int)b["x"], y = input.point.Y - (int)b["y"];
                int msg = message.ToInt32();
                IntPtr pointWindow = GetAncestor(WindowFromPoint(input.point), 2);
                if (x < 0 || y < 0 || x >= (int)b["width"] || y >= (int)b["height"] || (pointWindow != target && (hud == null || pointWindow != hud.Handle))) {
                    if (msg != 0x200 || buttons.Count > 0) Pause("Pointer interaction left the target; recording paused");
                } else {
                    double nx = x / (double)Math.Max(1, (int)b["width"] - 1), ny = y / (double)Math.Max(1, (int)b["height"] - 1);
                    if (nx != lastX || ny != lastY) { pendingMove = new Dictionary<string, object> { { "kind", "move" }, { "point", new Dictionary<string, object> { { "x", nx }, { "y", ny } } } }; pendingAt = Elapsed(); lastX = nx; lastY = ny; }
                    if (msg != 0x200) {
                        FlushMove(); string button = msg == 0x201 || msg == 0x202 ? "left" : msg == 0x204 || msg == 0x205 ? "right" : msg == 0x207 || msg == 0x208 ? "middle" : null;
                        if (button != null) {
                            bool down = msg == 0x201 || msg == 0x204 || msg == 0x207;
                            if (down && !buttons.Contains(button)) { MarkHeld(); buttons.Add(button); Add(new Dictionary<string, object> { { "kind", "button-down" }, { "button", button } }, Elapsed()); }
                            else if (!down && buttons.Remove(button)) Add(new Dictionary<string, object> { { "kind", "button-up" }, { "button", button } }, Elapsed());
                        } else if (msg == 0x20A || msg == 0x20E) {
                            double ticks = (short)(input.data >> 16) / 120.0;
                            if (ticks != Math.Truncate(ticks) || Math.Abs(ticks) > 20) Pause("Wheel delta is outside supported whole ticks (-20 to 20); recording paused");
                            else Add(new Dictionary<string, object> { { "kind", "scroll" }, { "ticks", (int)ticks }, { "axis", msg == 0x20E ? "horizontal" : "vertical" } }, Elapsed());
                        }
                    }
                }
            }
        } catch (Exception e) { Stop("failed", "Mouse recording failed: " + e.Message); }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    object State(bool includeEvents, bool drain) {
        var result = new Dictionary<string, object> {
            { "status", status }, { "reason", reason }, { "elapsedMs", Elapsed() }, { "countdownMs", status == "countdown" ? Math.Max(0, countdownEnd - clock.ElapsedMilliseconds) : 0 },
            { "eventCount", events.Count }, { "revision", revision }, { "target", targetInfo }, { "hotkeys", hotkeys }, { "botArmed", botArmed }, { "botActive", botActive }, { "commands", commands.ToArray() }, { "warnings", warnings.ToArray() }, { "captureStarted", captureStarted }
        };
        if (drain) commands.Clear(); if (includeEvents) result["events"] = events.ToArray(); return result;
    }
}

// Non-activating, click-through status only: it never receives recording or bot input.
sealed class RecordingHud : Form {
    internal readonly Label Caption = new Label { Dock = DockStyle.Fill, ForeColor = Color.White, Padding = new Padding(9) };
    internal RecordingHud() { FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; BackColor = Color.FromArgb(100, 20, 60); ClientSize = new Size(340, 76); StartPosition = FormStartPosition.Manual; Controls.Add(Caption); }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x20 | 0x80; return p; } }
    protected override void WndProc(ref Message m) { if (m.Msg == 0x84) { m.Result = new IntPtr(-1); return; } base.WndProc(ref m); }
}
