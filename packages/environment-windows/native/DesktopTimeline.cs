using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

partial class DesktopBridge {
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    static Thread TimelineThread;
    static bool TimelineRunning;
    static int TimelineCompleted, TimelineGeneration;
    static double TimelineStart, TimelinePosition, TimelineMaximum, TimelineSum;
    static string TimelineError;
    static readonly List<object> TimelineSamples = new List<object>();
    static object TimelineState() {
        return new { running = TimelineRunning, completed = TimelineCompleted, positionMs = TimelinePosition,
            maxLatenessMs = TimelineMaximum, meanLatenessMs = TimelineSum / Math.Max(1, TimelineCompleted),
            error = TimelineError, samples = TimelineSamples.ToArray() };
    }
    static void CancelTimeline(string reason) {
        if (!TimelineRunning) return;
        TimelineRunning = false; TimelineGeneration++; TimelineError = reason;
        TimelinePosition = Math.Max(0, Clock.Elapsed.TotalMilliseconds - TimelineStart);
    }
    static object StartTimeline(Dictionary<string, object> command) {
        CheckActive();
        if (TimelineRunning) throw new Exception("Timeline already active");
        if ((string)command["geometry"] != GeometryOf()) throw new Exception("Stale timeline geometry");
        var raw = (IList)command["events"];
        if (raw.Count == 0 || raw.Count > 10000) throw new Exception("Timeline event limit exceeded");
        var inputs = new List<Dictionary<string, object>>(); var times = new List<double>();
        double previous = 0;
        foreach (object value in raw) {
            var ev = (Dictionary<string, object>)value;
            double at = Convert.ToDouble(ev["atMs"]);
            if (double.IsNaN(at) || at < previous || at > 120000) throw new Exception("Invalid timeline order or duration");
            var input = new Dictionary<string, object>((Dictionary<string, object>)ev["action"]);
            string kind = (string)input["kind"];
            if (Array.IndexOf(new [] { "move", "relative-move", "scroll", "key-down", "key-up", "button-down", "button-up", "release-all" }, kind) < 0) throw new Exception("Timeline requires primitive edges");
            input["op"] = "input"; input["geometry"] = command["geometry"];
            inputs.Add(input); times.Add(at); previous = at;
        }
        for (int i = 256; i < times.Count; i++) if (times[i] - times[i - 256] < 10) throw new Exception("Timeline packet density exceeds 256 events per 10 ms");
        TimelineCompleted = 0; TimelinePosition = TimelineMaximum = TimelineSum = 0; TimelineSamples.Clear(); TimelineError = null;
        TimelineRunning = true; int generation = ++TimelineGeneration;
        TimelineStart = Clock.Elapsed.TotalMilliseconds + 20; // startup allowance, independent of receipt/IPC latency
        TimelineThread = new Thread(delegate() {
            bool precise = timeBeginPeriod(1) == 0;
            try {
                for (int i = 0; i < inputs.Count; i++) {
                    while (true) {
                        double remaining;
                        lock (Gate) {
                            if (!TimelineRunning || generation != TimelineGeneration) return;
                            remaining = TimelineStart + times[i] - Clock.Elapsed.TotalMilliseconds;
                        }
                        if (remaining <= 0) break;
                        Thread.Sleep(Math.Max(1, Math.Min(10, (int)Math.Floor(remaining))));
                    }
                    lock (Gate) {
                        if (!TimelineRunning || generation != TimelineGeneration) return;
                        double actual = Clock.Elapsed.TotalMilliseconds - TimelineStart;
                        if (actual - times[i] > 100) throw new Exception("Timeline more than 100 ms late; replay stopped before a catch-up burst");
                        if ((string)inputs[i]["kind"] == "release-all") { CheckActive(); Release(); } else Dispatch(inputs[i]);
                        // Dispatch includes safety validation; record the completion of SendInput, not just IPC submission.
                        actual = Clock.Elapsed.TotalMilliseconds - TimelineStart;
                        double late = Math.Max(0, actual - times[i]);
                        TimelineCompleted = i + 1; TimelinePosition = times[i]; TimelineMaximum = Math.Max(TimelineMaximum, late); TimelineSum += late;
                        if (TimelineSamples.Count < 512) TimelineSamples.Add(new { index = i, recordedMs = times[i], scheduledMs = TimelineStart + times[i], dispatchedMs = TimelineStart + actual, latenessMs = late });
                    }
                }
                lock (Gate) { if (generation == TimelineGeneration) TimelineRunning = false; }
            } catch (Exception e) { lock (Gate) { if (generation == TimelineGeneration) { Disarm(e.Message); TimelineError = e.Message; } } }
            finally { if (precise) timeEndPeriod(1); }
        }) { IsBackground = true, Name = "Macro timeline" };
        TimelineThread.Start(); return TimelineState();
    }
}
