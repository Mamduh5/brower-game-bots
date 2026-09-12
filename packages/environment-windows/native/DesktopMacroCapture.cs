using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;

sealed partial class DesktopRecorder {
    int macroCaptureGeneration;
    int macroCapturing;
    // PNG encoding and screen copies never run in the raw-input message loop during capture.
    void CaptureMacroFrame(bool synchronous) {
        if (!macroVisual || targetInfo == null || GetForegroundWindow() != target) return;
        if (Interlocked.CompareExchange(ref macroCapturing, 1, 0) != 0) return;
        var before = targetInfo; var captureTarget = target; string captureGeometry = geometry;
        var b = (Dictionary<string, object>)before["bounds"];
        int generation = macroCaptureGeneration, count = events.Count;
        double at = Math.Min(maxDurationMs, Elapsed()), requested = clock.Elapsed.TotalMilliseconds;
        var heldKeys = new List<string>(keys); var heldButtons = new List<string>(buttons);
        lastFrameAt = at; frameRevision = revision;
        frameInputRevision = inputStateRevision;
        Action capture = delegate {
            try {
                lock (frames) { if (generation != macroCaptureGeneration || frames.Count >= 8 || frameCount >= (synchronous ? 160 : 158) || frameBytes >= 8 * 1024 * 1024) return; }
                if (GetForegroundWindow() != captureTarget || clock.Elapsed.TotalMilliseconds - requested > 40) return;
                var w = DesktopBridge.Window(captureTarget);
                if (!w["pid"].Equals(before["pid"]) || !w["processStartedAt"].Equals(before["processStartedAt"])) return;
                int width = (int)b["width"], height = (int)b["height"];
                if ((long)width * height > 16000000) return;
                byte[] bytes;
                using (var bitmap = new Bitmap(width, height)) {
                    using (var g = Graphics.FromImage(bitmap)) g.CopyFromScreen((int)b["x"], (int)b["y"], 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
                    double scale = Math.Min(1, 320.0 / Math.Max(width, height));
                    using (var small = new Bitmap(bitmap, new Size(Math.Max(1, (int)(width * scale)), Math.Max(1, (int)(height * scale)))))
                    using (var stream = new MemoryStream()) { small.Save(stream, ImageFormat.Png); bytes = stream.ToArray(); }
                }
                var after = DesktopBridge.Window(captureTarget); var ab = (Dictionary<string, object>)after["bounds"];
                if (GetForegroundWindow() != captureTarget || !after["pid"].Equals(before["pid"]) || !after["processStartedAt"].Equals(before["processStartedAt"]) || !after["dpi"].Equals(before["dpi"])) return;
                foreach (string field in new [] { "x", "y", "width", "height" }) if (!ab[field].Equals(b[field])) return;
                lock (frames) {
                    if (generation != macroCaptureGeneration) return;
                    frames.Add(new { window = before, geometry = captureGeometry, png = Convert.ToBase64String(bytes), capturedAt = DateTime.UtcNow.ToString("o"), atMs = at, eventCount = count, heldKeys = heldKeys, heldButtons = heldButtons });
                    frameCount++; frameBytes += bytes.Length;
                }
            } catch { /* Missing visual evidence is rejected at replay; input recording continues. */ }
            finally { Interlocked.Exchange(ref macroCapturing, 0); }
        };
        if (synchronous) capture(); else ThreadPool.QueueUserWorkItem(delegate { capture(); });
    }
}
