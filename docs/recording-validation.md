# Recording/replay implementation and validation

This change adds human demonstration recording, editable saved configurations, separate recording/bot starts, configurable hotkeys, timed playback and loops. It adds no autonomous game intelligence and no npm/native package dependency. See the [operating guide](recording.md) for the complete workflow and limitations.

## Code-level results

Completed for this change:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed across the workspace |
| `pnpm build` | Passed across all 21 non-root workspace projects |
| `pnpm test` | Passed: 154 tests in 30 files |
| `pnpm exec playwright test tests/e2e/desktop-gui.spec.ts --workers=1 --reporter=line` | Passed: 3 headless GUI/HTTP tests; native control endpoints mocked |
| `node packages/environment-windows/scripts/build-native.mjs` | Passed: C# compilation only |
| `node --check apps/bot-gui/public/desktop.js` | Passed |
| `git diff --check` | Passed; repository CRLF conversion notices only |

The repository's `lint` command is the same TypeScript build check as `typecheck`; no additional linter is configured. Logs are in ignored `artifacts/recording-{typecheck,build,unit,gui}-validation.log`. The native compiler is silent on success.

New coverage checks ordered down/up conversion and overlapping holds, legacy profile compatibility, malformed loops/hotkeys, enabled/disabled events, recorded timing, inserted waits, finite/infinite loop bounds, initial versus loop delay, pause/resume timing and hold restoration, mid-loop cancellation, controller coordination, hotkey persistence without persistent arming, stale queued starts, emergency-stop precedence, and registration failures using fakes. The GUI test covers recording countdown cancellation, pause/resume/stop, draft conversion without auto-playback, hold/timing edits, disabling/duplicating/reordering/inserting/deleting events, save/copy/reload and separately arming/cancelling the bot. Existing browser and desktop unit/integration tests also passed.

**No real desktop recording or playback was performed for this change.** No Roblox/game, manually operated desktop application, native fixture, native smoke suite or real-game visual validation was run. The new native recorder, hotkey registration and overlay were compiled and reviewed, not exercised. Earlier [native desktop validation](desktop-validation.md) records pre-existing controller work and is not evidence that recording works in a real application.

## Manual checks left for you

1. Rebuild with `pnpm desktop:setup`, start `pnpm gui`, select your intended target, and try Button, Countdown and armed F6 recording starts. Confirm the overlay stays visible without stealing focus and click-through behavior works in that application. Cancel a countdown with Stop/Discard/F8 and confirm capture never begins.
2. Record W held while tapping Space, moving/clicking, dragging with left/right/middle buttons, scrolling and using a supported application chord. Inspect the resulting timing and down/up pairs. Include idle time before Stop; confirm the sequence retains it. Check both short/fast inputs and longer holds.
3. Switch to the GUI/another application, move/resize the target, and minimize/close it. Confirm capture pauses or ends with a reason, unrelated input is excluded, and resuming requires released physical controls. Inspect the captured prefix after a failure.
4. Edit coordinates, keys, matching hold duration, delays, ordering, waits and enabled state. Save, copy, reload after a server restart, and compare playback. Move the window between recording and playback; also assess resized layouts and another monitor/DPI.
5. Try Button, Countdown and armed F7 bot starts. Confirm control keys are absent from the recording and are never synthesized as gameplay actions. Check a registered-key collision, duplicate shortcut rejection, persistence, and that a server restart never restores an armed start.
6. Run once, N times and until stopped with a visible loop delay. Confirm the start countdown happens once, the loop counter advances, and the action/time limits still end a run. Pause/resume inside a hold and between loops. Check Stop/F8 during countdown, during held input and midway through a repetition.
7. Close the target or exit the GUI server during playback and verify injected controls release. Check actual game acceptance, camera behavior, pointer capture and sensitivity separately: passing dispatch tests does not establish that a game accepts synthetic input.

The recorder never injects releases into your physical input. Release your own held keys/buttons before resuming. Raw-input/locked-cursor cameras, fractional wheel deltas, unsupported keys/IME/gamepads and exclusive-fullscreen overlays remain limitations described in the operating guide.

## Integration decisions

- The native helper gained an opt-in message-thread recorder; it reuses target identity/client geometry and the desktop session mutex. Existing playback still uses the original `SendInput` executor and independent watchdog.
- Configuration version 1 remains in use. Per-event `delayBeforeMs`/`enabled`, `playback`, `loop` and `maxHoldMs` are additive; existing profiles remain valid. Recorded events are ordinary existing desktop actions, not a separate player format.
- The GUI server serializes recording, bot and hotkey requests. Recordings remain drafts until explicitly saved. Bot arming snapshots the selected target/profile. Starts are never persisted.
- Recorded playback schedules input edges without screenshots between them, preserving overlapping held state. Screenshots/reports still use the existing artifact store. Fixed-interval manual playback and the existing policy seam remain available; no new policy/provider was added.
- Client-relative normalized mouse positions allow window movement between sessions. Capture coalesces positions, suppresses repeat/injected/control events, and pauses on target/focus/geometry problems.

## Changed-file inventory

Paths below are relative to the repository root. Generated native binaries, build output and validation logs are ignored artifacts.

| Files | Change |
| --- | --- |
| `README.md`, `apps/bot-gui/README.md`, `docs/desktop.md` | Updated entry points and existing operating instructions |
| `docs/recording.md`, `docs/recording-validation.md` (new) | Recording guide, validation and manual checklist |
| `apps/bot-gui/public/desktop.html`, `desktop.css`, `desktop.js` | Separate recording/review/playback UI, editor, hotkeys, countdowns and loops |
| `apps/bot-gui/src/desktop-recording-manager.ts` (new) | Serialized recording/hotkey/bot orchestration and draft conversion |
| `apps/bot-gui/src/server.ts` | Recording/settings API and controller integration |
| `apps/bot-gui/test/desktop-recording-manager.test.ts` (new) | Fake-controller orchestration tests |
| `packages/environment-sdk/src/recording.ts` (new) | Validated recorder contracts, events and shortcut settings |
| `packages/environment-sdk/src/desktop.ts`, `src/index.ts` | Optional hold bound and recording exports |
| `packages/environment-windows/native/DesktopRecorder.cs` (new) | Scoped hooks, recording state, control hotkeys and overlay |
| `packages/environment-windows/native/DesktopBridge.cs` | Recorder routing and configurable existing hold watchdog |
| `packages/environment-windows/scripts/build-native.mjs` | Compile the added recorder source |
| `packages/environment-windows/src/windows-session.ts` | Recorder RPC adapter and hold bound |
| `packages/game-sdk/src/recording.ts` (new) | Recording-to-profile conversion |
| `packages/game-sdk/src/desktop-profile.ts`, `src/index.ts` | Additive timing, loop and editor metadata schemas/exports |
| `packages/game-sdk/test/recording.test.ts` (new) | Conversion and compatibility tests |
| `packages/agent-player/src/application/desktop-runner.ts` | Recorded scheduling, pause restoration, loop execution and state |
| `packages/agent-player/test/desktop-runner.test.ts` | Timing, cleanup and loop coverage |
| `tests/e2e/desktop-gui.spec.ts` | Headless GUI contracts with mocked native endpoints |

All source changes are left uncommitted. No commit, push, pull request, branch creation/change or repository rename was performed.
