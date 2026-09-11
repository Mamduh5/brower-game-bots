using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;

// Harmless owned target: no files edited except an optional test event log.
class DesktopFixture : Form {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    readonly HashSet<Keys> held = new HashSet<Keys>();
    readonly string log;
    int clicks, wheel, x = 180, y = 200;
    string last = "Ready";
    DesktopFixture(string path) {
        log = path; Text = "Game Bots - Native Input Fixture"; ClientSize = new Size(640, 480);
        StartPosition = FormStartPosition.CenterScreen; KeyPreview = true; DoubleBuffered = true;
        KeyDown += delegate(object sender, KeyEventArgs e) { held.Add(e.KeyCode); Record("key-down " + e.KeyCode); if (e.KeyCode == Keys.W) y -= 10; if (e.KeyCode == Keys.S) y += 10; if (e.KeyCode == Keys.A) x -= 10; if (e.KeyCode == Keys.D) x += 10; };
        KeyUp += delegate(object sender, KeyEventArgs e) { held.Remove(e.KeyCode); Record("key-up " + e.KeyCode); };
        MouseDown += delegate(object sender, MouseEventArgs e) { clicks++; Record("button-down " + e.Button + " " + e.X + "," + e.Y); };
        MouseUp += delegate(object sender, MouseEventArgs e) { Record("button-up " + e.Button); };
        MouseMove += delegate(object sender, MouseEventArgs e) { Record("move " + e.X + "," + e.Y); };
        MouseWheel += delegate(object sender, MouseEventArgs e) { wheel += e.Delta; Record("wheel " + e.Delta); };
        Deactivate += delegate { held.Clear(); Record("deactivated"); };
        Shown += delegate {
            var reader = new Thread(delegate() {
                string command;
                while ((command = Console.ReadLine()) != null) {
                    string value = command;
                    BeginInvoke((Action)delegate {
                        if (value == "activate") { WindowState = FormWindowState.Normal; Activate(); }
                        else if (value == "move-window") { Left += 25; Top += 15; }
                        else if (value == "resize") ClientSize = new Size(700, 500);
                        else if (value == "minimize") WindowState = FormWindowState.Minimized;
                        else if (value == "state") Record("physical W=" + ((GetAsyncKeyState(87) & 0x8000) != 0) + " Left=" + ((GetAsyncKeyState(1) & 0x8000) != 0));
                        else if (value == "release-test-input") { keybd_event(87, 0, 2, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
                        else if (value == "emergency") { keybd_event(0x77, 0, 0, UIntPtr.Zero); var timer = new System.Windows.Forms.Timer { Interval = 150 }; timer.Tick += delegate { keybd_event(0x77, 0, 2, UIntPtr.Zero); timer.Stop(); timer.Dispose(); }; timer.Start(); }
                        else if (value == "close") Close();
                    });
                }
            }) { IsBackground = true }; reader.Start();
        };
    }
    void Record(string value) { last = value; if (!string.IsNullOrEmpty(log)) File.AppendAllText(log, value + Environment.NewLine); Invalidate(); }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); e.Graphics.Clear(Color.FromArgb(24, 30, 44));
        using (var font = new Font("Segoe UI", 14)) e.Graphics.DrawString("Native input fixture\nWASD: move square | Space: jump event\nClicks: " + clicks + "   Wheel: " + wheel + "\nHeld: " + string.Join(", ", held) + "\nLatest: " + last + "\nF8 stops the bot at any time.", font, Brushes.White, 20, 20);
        e.Graphics.FillRectangle(Brushes.Turquoise, x, y + 100, 40, 40);
    }
    [STAThread] static void Main(string[] args) { SetProcessDpiAwarenessContext(new IntPtr(-4)); Application.EnableVisualStyles(); Application.Run(new DesktopFixture(args.Length > 0 ? args[0] : null)); }
}
