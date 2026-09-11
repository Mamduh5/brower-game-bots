# Desktop implementation validation

Validated on 2026-09-11 in the repository's Windows x64 workspace, Node 22.17.1, pnpm 10.0.0. The interactive desktop used a 1920×1080 display at 96 DPI. All physical automation targeted the checked-in WinForms fixture. No Roblox client or third-party game was used.

## Results

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass: TypeScript project references compile |
| `pnpm build` | Pass: all 21 non-root workspace packages/apps |
| `pnpm desktop:setup` | Pass: x64 bridge and fixture compile using .NET Framework C# compiler |
| `pnpm test` | Pass: 28 files, 124 tests; includes all existing browser tests and 33 new runner/configuration/security cases |
| `pnpm test:e2e` | Pass: 4 tests; existing Player and Tester CLI artifact smoke tests plus 2 desktop GUI/API tests |
| `pnpm test:desktop` | Pass: 14 groups of real native/GUI checks listed below |
| `git diff --check` | Pass; Git emitted its normal LF/CRLF conversion notices |

The first browser E2E attempt failed strict empty-stderr assertions because the environment inherited both `NO_COLOR` and `FORCE_COLOR`; the Player and Tester runs themselves completed. Removing `NO_COLOR` in the test shell resolved this without changing existing tests or suppressing errors. The installed pnpm launcher also emits an existing `pnpm.onlyBuiltDependencies` configuration warning. Neither warning is a compiler/test failure. On Windows PowerShell, redirected native stderr can set the shell's success flag independently of the native exit code; validation uses the command exit code.

## New deterministic tests

Runner tests cover bounded execution, screenshots before/after actions, unknown versus verified progress, evidence/report output, cancellation during start delay, pause/release/resume, wall duration while paused, observation failure after held input, target loss, focus loss without automatic refocusing, unchanged-screen pausing, missing policy rejection, configured skill resolution, goal/history delivery, distinct before/after verification observations, non-cooperative policy cancellation, and invalid policy output rejection before physical dispatch.

Configuration tests reject invalid action rates/counts/durations/start delays, empty sequences, unsupported run modes/actions, F8/Meta assignments, out-of-bounds points, excessive relative movement/holds, and duplicate skill identifiers. Chord/held-button and normalized-point configuration are accepted. API tests cover localhost access, same-origin JSON, hostile Origin/Host, cross-site headers, non-JSON writes and LAN rejection.

GUI E2E runs a real browser against the real HTTP/static server. It navigates from the existing dashboard, edits and saves a configuration through the real profile API, reloads it, builds a chord without source editing, and verifies Start/Pause/Resume/Stop plus screenshot/report URLs against controlled run responses. A separate HTTP test rejects hostile origins, invalid configurations and oversized bodies. Physical input is intentionally isolated to the native smoke test, which also exercises the real GUI launch API.

## Real Windows smoke checks

1. Window enumeration/selection, visible PNG capture, client dimensions, left/right/middle clicks, key down/up, Control+A, W+Space, overlapping keyboard/mouse state, relative movement, dragging, and vertical wheel events verified from fixture event logs and changed screenshot hashes.
2. Abort during a long W+left-button hold; both helper-tracked state and actual Windows key/button state become released.
3. A second fixture becomes foreground; the helper disarms and releases input.
4. Move the target window while holding W; disarm and OS release.
5. Resume and attempt an action using an old geometry token; rejected before clicking.
6. Resize the target; disarm and OS release.
7. Minimize the target; disarm and OS release.
8. The fixture generates F8 through ordinary input; the global stop latches, releases input, and refuses resume.
9. Close a session while holding W; actual OS state is released.
10. Force-terminate a disposable Node controller holding W and left mouse; the detached helper survives long enough to release both, then exits.
11. Stall a disposable controller's event loop for 3.5 seconds; the helper expires its heartbeat and releases input.
12. Maintain held inputs for six seconds with a live heartbeat; the independent 5.5-second hold limit disarms/releases.
13. Exceed a 1.5-second native run deadline while input is held; disarm/release.
14. Launch the real GUI server, enumerate the fixture, capture a setup preview, start the editable nine-action native control profile through HTTP, observe completion, and retrieve the PNG and JSON report through the existing artifact-serving route.

The crash test initially exposed a real bug with ordinary child-process lifetime. The adapter now uses a detached hidden helper with redirected UTF-8 streams, parent/heartbeat checks and EOF cleanup. The crash, stall and normal shutdown cases were rerun successfully after this correction. No helper or fixture processes were left running after validation.

Evidence is generated under ignored `artifacts/desktop-smoke-<timestamp>/` (fixture log, before/after PNGs, results JSON), `artifacts/desktop-<uuid>/` (real GUI-run configuration, screenshots and final report), and validation logs in `artifacts/*-validation.log`. The GUI E2E also saves `artifacts/desktop-gui.png`; its run state is controlled test data, not evidence of game play.

## Unverified / intentionally absent

- Roblox gameplay, Roblox synthetic-input acceptance, enemies/resources/farming, and game-specific goal verification.
- Relative motion as a raw-input game camera; the fixture confirms ordinary relative pointer/input delivery only.
- Horizontal wheel event consumption by a real target (implemented, not asserted by the fixture).
- Multiple monitors, negative physical monitor origins, mixed DPI, DPI transitions and alternate keyboard layouts on real hardware. The adapter implements the coordinate/DPI path; validation used one 96-DPI display.
- Exclusive fullscreen, protected capture surfaces, remote/locked desktops, secure desktops, elevated targets, and forced termination of the native helper itself.
- OCR/template/visual target tracking, arbitrary Unicode text/IME, gamepad input, bundled visual reasoning provider, automatic learned skills, native SQLite integration, and replay discovery after GUI-server restart.

No autonomous visual reasoning is claimed by the deterministic test policy or screenshot hash comparisons. The system provides the control/observation foundation and an explicit policy seam.

## Working-tree file inventory

All changes are uncommitted on the existing `main` branch. No commit, push, pull request, repository rename or branch change was performed. Generated binaries, build output, saved test data and evidence remain in ignored paths.

| Status | File |
| --- | --- |
| Modified | `README.md` |
| Modified | `apps/bot-gui/README.md` |
| Modified | `apps/bot-gui/package.json` |
| Modified | `apps/bot-gui/public/index.html` |
| Modified | `apps/bot-gui/src/server.ts` |
| Modified | `apps/bot-gui/tsconfig.json` |
| Modified | `package.json` |
| Modified | `packages/agent-player/package.json` |
| Modified | `packages/agent-player/src/index.ts` |
| Modified | `packages/agent-player/tsconfig.json` |
| Modified | `packages/environment-sdk/src/index.ts` |
| Modified | `packages/game-sdk/src/index.ts` |
| Modified | `pnpm-lock.yaml` |
| Modified | `tsconfig.base.json` |
| Modified | `tsconfig.json` |
| New | `apps/bot-gui/public/desktop.css` |
| New | `apps/bot-gui/public/desktop.html` |
| New | `apps/bot-gui/public/desktop.js` |
| New | `apps/bot-gui/src/desktop-manager.ts` |
| New | `apps/bot-gui/src/desktop-security.ts` |
| New | `apps/bot-gui/test/desktop-security.test.ts` |
| New | `docs/adr/0005-native-desktop-control.md` |
| New | `docs/desktop-validation.md` |
| New | `docs/desktop.md` |
| New | `packages/agent-player/src/application/desktop-runner.ts` |
| New | `packages/agent-player/test/desktop-runner.test.ts` |
| New | `packages/environment-sdk/src/desktop.ts` |
| New | `packages/environment-windows/.gitignore` |
| New | `packages/environment-windows/native/DesktopBridge.cs` |
| New | `packages/environment-windows/native/DesktopFixture.cs` |
| New | `packages/environment-windows/package.json` |
| New | `packages/environment-windows/scripts/build-native.mjs` |
| New | `packages/environment-windows/src/index.ts` |
| New | `packages/environment-windows/src/windows-session.ts` |
| New | `packages/environment-windows/tsconfig.json` |
| New | `packages/game-sdk/src/desktop-profile.ts` |
| New | `packages/game-sdk/test/desktop-profile.test.ts` |
| New | `profiles/desktop/clicker.json` |
| New | `profiles/desktop/native-control-test.json` |
| New | `scripts/desktop-fixture.mjs` |
| New | `scripts/desktop-smoke.mjs` |
| New | `scripts/desktop-watchdog-child.mjs` |
| New | `tests/e2e/desktop-gui.spec.ts` |
