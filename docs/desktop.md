# Windows desktop automation

The GUI can configure bounded mouse/keyboard automation against a selected native Windows window. The same controls expose a screenshot-driven policy boundary for future game agents. Browser Player, Tester, plugins, CLI commands and browser replay remain available.

This release has **no general visual AI provider** and **no autonomous Roblox farming agent**. Goal text is saved as intent and passed to an installed `DesktopPolicy`; deterministic automation does not interpret it.

## Setup and quick start

Requirements: Windows 10 version 1703 or later / Windows 11, x64, an unlocked interactive desktop, Node 22+, the repository's pnpm version, and the Windows .NET Framework 4.x compiler at `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. The helper uses .NET Framework's System.Drawing, WinForms, and JSON serializer. No Python, paid automation package, model key, game injection, or additional npm dependency is required. Existing `zod` is reused for validation.

From the repository root:

```powershell
pnpm install
pnpm desktop:setup
pnpm build
pnpm gui
```

Open `http://127.0.0.1:5178/desktop.html`, or select **Desktop automation** from the existing dashboard. `pnpm gui` also builds workspace dependencies, so the GUI works on a fresh checkout. Use the printed port if overridden.

Run the harmless fixture in another terminal:

```powershell
pnpm desktop:fixture
```

The fixture is a visible local WinForms window. WASD moves a square; it displays mouse, keyboard, wheel and held-input events. Close its window when finished. The bridge itself stays hidden.

Use ordinary, equally privileged applications. Windows can reject `SendInput` to a higher-integrity application; failures are surfaced. Do not use the bridge for secure desktops, UAC prompts, a locked session, remote unattended control, or background gameplay. If Windows/application policy prevents compilation or input, that platform restriction remains in effect.

## Configure an auto clicker or sequence

1. Open the target application. Choose **Refresh windows**, then select its title/process/PID. Configurations do not save stale handles: select a window each time.
2. Optionally choose **Capture target preview**. This requests focus and captures the visible client area without sending gameplay input. Return to the GUI and click a point on the preview to fill the last Click/Move action's X/Y fields.
3. Load **Clicker example**, or edit the default action. Choose left/right/middle click, point, and press duration. Coordinates are client-area percentages, from 0 to 100. Borders and title bars are excluded.
4. Set the interval after each action, action limit, wall-clock duration, and start delay. **Add action** builds an ordered sequence without editing source. Remove actions individually to change the sequence.
5. Give the configuration a name and choose **Save configuration**. Saving the same name replaces it. Profiles survive GUI restarts in `data/desktop-profiles/*.json`; bundled examples are in `profiles/desktop/*.json`. Saved user versions override examples with the same name.
6. Choose **Start** and allow the target to stay foreground. **Pause** releases held input; **Resume** explicitly requests focus and takes a fresh observation. **Stop input** terminates the run.

**Press F8 anywhere on the interactive desktop for emergency stop.** The helper polls it independently of the GUI and Node, nominally every 20 ms, and before input. F8 latches: a new run is required. It cannot be assigned as a gameplay key. The GUI also shows the stop button at the top of the page.

The sequence repeats in order until either limit is reached. Both limits are mandatory safety bounds (defaults: 100 attempts, 60 seconds). Limits include start delay and paused time. Allowed range: 1–10,000 action attempts, 1–3,600 seconds, interval 100–60,000 ms, and start delay 0–60 seconds. The interval is an additional delay after each action, not a promised click frequency: capture/input costs and press duration also count. Maximum requested sequence rate is 10 actions/sec; real screenshot-driven throughput is lower. Attempts that were interrupted count toward the limit and are not automatically retried.

Action choices:

| Action | Configuration |
| --- | --- |
| Click / Move | Client X/Y percentages; Click also selects button and press duration |
| Press / hold | Comma-separated keys such as `KeyW,Space` or `Control,KeyA`; optional `left,right,middle` buttons; duration |
| Key down / up | A named key; down persists across subsequent actions until up/cleanup |
| Mouse button down / up | Persistent left/right/middle state; move the pointer into the target first |
| Relative mouse movement | Signed delta X/Y, each bounded to ±1,000; optionally hold right mouse or a game's configured camera button |
| Drag | Start/end client percentages, button, duration; interpolated through 20 points |
| Scroll | Signed wheel ticks (±20), vertical or horizontal; one tick is 120 Windows wheel units |
| Wait / Release all | A bounded delay, or explicit release of every input held by this session |

Keys: `KeyA`–`KeyZ`, `Digit0`–`Digit9`, Space, Enter, Tab, Escape, Backspace, Delete, arrows, Shift, Control, Alt, Home, End, PageUp/PageDown, and F1–F12 except F8. Common application chords work through the hold action. Windows/Meta keys and OS switching/closing chords such as Alt+Tab, Alt+F4, Alt+Space and Ctrl+Alt+Delete are excluded. Unexpected physical modifier presses stop input. Unicode text/IME composition and arbitrary shell commands are not supported.

All durations are bounded to 5 seconds per action. A continuous held-input episode is independently limited to 5.5 seconds in the helper, including time between actions. For longer movement, compose bounded holds with release between them. Key/button down steps can overlap with movement, other keys, or buttons. Chords are delivered in order a few milliseconds apart; this is overlapping state, not exact hardware simultaneity. Click/drag refuse a button already held by the session. Hold preserves pre-existing held state on success; errors release everything.

The **Feedback guard & reusable behaviors** section can save the current sequence as a named behavior and reuse it later. Save the enclosing configuration to persist behaviors. Game mappings live here or in a future game integration; the runtime contains no Roblox control rules. The native test profile's WASD/Space/E/right-button examples are editable mappings, not universal game semantics.

## Window and input safety

The helper pins handle, PID and process start time, verifies visibility and foreground identity, and records client origin, dimensions and DPI. It translates normalized client coordinates to physical virtual-desktop coordinates with per-monitor DPI awareness v2, including negative monitor origins. Window movement, resizing or DPI changes disarm input; resume requires a fresh screenshot. A disappeared/minimized target stops the run. An unexpected foreground change pauses it, releases state, and never automatically steals focus back.

Mouse targets must be inside the client area and belong to the selected root window at the point of input. Relative motion and wheel/button actions require the pointer to be inside the intended window. Window geometry is checked before primitive dispatch and by the watchdog. There is still an unavoidable small race between checking foreground ownership and Windows processing a global input event. This is ordinary desktop input, not an isolated input channel.

A named Windows mutex permits one bound desktop input session at a time, including across GUI instances. A detached helper independently checks controller lifetime, a 2.5-second heartbeat lease, the run deadline, F8, geometry, focus and maximum hold time. It tracks only its own injected keys/buttons, checks `SendInput` results and retries failed releases while alive. Normal stop, pause, cancellation, controller crash and controller event-loop stall release input. Killing the **native helper itself**, terminating its entire process tree, OS failure, or switching to a higher-integrity/secure desktop can defeat cleanup; no user-space helper can promise otherwise. F8 only works while the helper is alive on the interactive desktop.

Desktop APIs and desktop evidence are localhost-only, validate Host/Origin, reject cross-site control and require JSON for mutations. Keep the GUI local; the browser dashboard's pre-existing LAN option does not enable remote desktop control. Closing the GUI browser tab does not stop a run; F8, the stop control, or the run limits do. Exiting the GUI server causes helper cleanup.

## Observe → decide → act → verify

`DesktopSession` in `environment-sdk` is independent of DOM/navigation contracts. `WindowsDesktopSession` implements it with the native helper. `DesktopRunner` in `agent-player` orchestrates both deterministic automation and a pluggable `DesktopPolicy`:

1. Capture the visible target client area, geometry token, timestamp and SHA-256.
2. For automation, select the next configured action. For feedback, call `decide` with goal, pixels, 20 recent action/observation-history entries, configured skills, remaining actions and elapsed time.
3. Validate the complete decision. Execute at most 16 proposed actions or a configured behavior of at most 32 actions; global attempt/time limits still apply. Capture after each action. Held state can overlap inside that bounded batch.
4. Release held state before model calls. Call `verify` with the pre-batch observation and the latest observation/context. Record `progress`, `no-progress`, or `unknown` with the provider's reason. Three consecutive verified no-progress batches pause for inspection; a policy can choose a different action/skill on the next decision.
5. Complete, stop, continue, or pause for human recovery. Invalid provider output, provider timeout, input failure and target loss fail closed. No blind retries are performed because an interrupted action may already have taken effect.

`DesktopPolicy` is a typed integration seam, not a bundled model. A provider has `decide(context, signal)` and `verify(context, before, lastAction, signal)` methods. `before` covers the bounded batch; `context.history` contains individual attempted steps, and `lastAction` identifies the most recent completed step. Providers can resolve a configured `skillId` without gaining access to the raw session. Calls have 15-second timeouts and cancellation; late responses are discarded. In-process providers must cooperate with cancellation for their own network/resource cleanup, but they cannot send physical input through the policy interface.

The current GUI deliberately launches only automation. Programmatic integrations construct `DesktopRunner(session, artifactStore, target, profile, policy)` with `profile.mode = "feedback"`. Starting feedback without a provider fails before binding. Future game policies can live under `games/*`; no new game plugin is invented just to name a control mapping.

Deterministic mode records pixel changes as **unknown goal progress**. Optional unchanged-screen detection pauses after the configured count; animated games may change continuously while stuck, and a successful click may leave identical pixels. There is no OCR, object detector, template tracking, resource counter or semantic win detector in this release.

## Evidence and reports

Native artifacts use the existing `FsArtifactStore` under `artifacts/desktop-<uuid>/`. `reports/configuration.json` is saved before input. `reports/desktop-summary.json` contains final state, target/profile, attempted actions, screenshot hashes/geometry, verification results, errors, recent history, logs and retained evidence references. The GUI shows current status, latest action, screenshot and a report link.

Retain up to 100 immutable screenshots with a combined 64 MiB budget. Subsequent captures overwrite `screenshots/latest.png`; their hashes remain in the report but older overwritten images are not replay evidence. Each capture is limited to 16 megapixels. Logs/history metadata are bounded by action/run limits. Screenshots are local but can contain visible personal information; do not include secrets in goals/configurations. No screenshot is uploaded to a model in the shipped implementation.

The latest native run remains visible in the GUI process. After restart, open the JSON report from disk. Native reports are not added to the browser-specific replay index or SQLite browser lifecycle. A controller crash can leave only configuration/screenshots; a final report requires the controller to finish its cleanup path.

## Native game / Roblox validation

First run the owned fixture smoke test:

```powershell
pnpm test:desktop
```

It builds both TypeScript and native helpers, opens local fixture windows, sends bounded input, and intentionally crashes/stalls disposable test controllers. It never opens Roblox or another third-party game. Do not interact with the mouse/keyboard during the automated test; F8 remains available to stop it. It saves fixture event logs, before/after screenshots, test results, and a real GUI-launched native run report under `artifacts/`.

For a manual Roblox test, open a Roblox client in an **owned/private/test experience where automation is permitted**. Use windowed/borderless mode. Select the native client by title/process/PID in the GUI, capture a preview, and load **Native control test (owned targets only)**. Review mappings, focus the playable scene, then start the bounded nine-action test. Inspect movement/jump/camera/click/interact responses and repeated screenshots; try F8, pause/resume, and switching focus. Game menus can consume keys, controls vary by experience, and Roblox may ignore synthetic input. Record what the actual experience accepted; do not infer it from successful Win32 dispatch.

**Roblox was not launched or validated during implementation.** The general nine-action control profile was validated against the native fixture. No public farming or competitive automation was performed. No injection, executable modification, memory reading, private hooks, packet manipulation, anti-cheat bypass or evasion exists.

## Known limitations and troubleshooting

- **Focus denied:** Windows restricts foreground requests. Select the target manually, release physical keys/buttons, then use Resume. No focus-stealing workaround is installed.
- **Geometry/focus pause:** Keep the target visible and stationary. Resume after checking a fresh preview. Popup/child top-level windows may be different targets; the helper will not silently follow them.
- **Black/occluded screenshots:** Capture is visible GDI screen capture. Minimized, protected, exclusive-fullscreen, hardware-overlay or covered surfaces are not reliable. Use a visible windowed target. The adapter does not pretend to capture hidden game frames.
- **Relative camera motion ignored:** Relative `SendInput` is implemented and tested as ordinary pointer motion; game raw-input/camera acceptance remains game-specific. Pointer acceleration and game sensitivity affect it. No bypass is attempted.
- **Keys appear wrong:** Key names map Windows virtual keys to scan codes using the helper's keyboard layout. Unicode typing, IME, gamepad and non-Windows platforms are outside this release.
- **Run stops on held-input limit:** Replace long key-down sequences with shorter hold/release episodes. A held key during a long interval still counts toward the 5.5-second safety limit.
- **Helper missing:** Run `pnpm desktop:setup`. Re-run it after changing native sources. Binaries are generated in ignored `packages/environment-windows/bin/`; TypeScript-only build remains usable on other platforms.
- **Existing E2E stderr warning:** If both `NO_COLOR` and `FORCE_COLOR` are inherited, Node warns and existing strict stderr assertions fail. Remove `NO_COLOR` in the test shell, then rerun; do not suppress general error output.

## Validation commands

```powershell
pnpm typecheck
pnpm build
pnpm test
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
pnpm test:e2e
pnpm test:desktop
```

See [validation record](desktop-validation.md) for the actual implementation-session results and [ADR 0005](adr/0005-native-desktop-control.md) for the architecture/research rationale.
