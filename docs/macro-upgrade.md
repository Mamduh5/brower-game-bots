# Macro fidelity and visual correction: implementation and validation

Baseline HEAD: `51fa51aa9bbeb07422998d69bfb566f387f0045d` on `main`.
Validation completed on 2026-09-12 from the existing uncommitted tree.
This continuation made no feature changes. It supplied this missing report,
which was already linked from `recording.md`.

## Root causes and input fidelity

Inspection against baseline identified integer receipt timestamps, coalesced
cursor-position mouse capture, and per-action native IPC/rate limits as fidelity
constraints. Cursor positions cannot preserve camera motion under cursor
confinement or recentering. Input-only playback also lacked visual evidence to
detect a different starting view or accumulated scene displacement. These are
code-level findings, not a measured before/after game benchmark.

Macro now records keyboard and mouse Raw Input through one message queue with
fractional monotonic receipt times. It preserves overlapping key/button edges,
relative device deltas, absolute pointer positions, and fractional wheel ticks
in Windows wheel units. The original stream is retained in `macro.source` beside
editable actions. Injected device-less packets are excluded; teaching retains
its existing hook capture path.

Primitive recorded playback uses one native deadline timeline per segment,
with a 20 ms startup allowance and a scoped 1 ms timer period. Later deadlines
do not shift with ordinary dispatch lateness. More than 100 ms lateness stops
playback before an overdue burst. Safety checks still guard input and cleanup.
Timestamps measure receipt and dispatch, not hardware sampling or game frames;
this is not a hard real-time guarantee.

## Relative camera handling

Explicit absolute and relative capture are available. Automatic capture selects
relative input for a hidden cursor or right-button hold. Relative replay sends
the captured deltas with mouse-move coalescing disabled and preserves button
holds rather than warping the cursor during camera motion. Automatic selection
is heuristic. Device sensitivity, acceleration, game input processing, and
render timing can still alter the resulting camera displacement.

## Visual trajectory, checkpoints, and drift correction

Macro captures an initial image, periodic images, and a final image where
available. Images are reduced to at most 320 pixels on the longest side;
analysis extracts up to 96 normalized corner patches on a 160 by 120 grid.
Adjacent-frame consensus strengthens persistent patches. Replay checks the
starting view before input and compares translation/scale at neutral input
boundaries. It reports demonstrated A-to-B displacement separately from replayed
A'-to-B' displacement. Active-input samples provide response evidence; they do
not interrupt held input for correction.

Small corrections require an isolated demonstrated response. Camera correction
is limited to 40 counts and 30% of the example; movement additions are limited
to 120 ms and 25% of the demonstrated interval. Start alignment permits camera
correction only. Movement additionally requires comparable measured under-travel;
overshoot does not invent a reverse route. There are at most two attempts per
checkpoint and eight per loop. Failure to improve or reversal stops correction.
Visual inspection extends neutral intervals, so full wall-clock reproduction
across those intervals is not guaranteed.

Missing objects become unmatched patches and independently moving objects become
geometric outliers. This is geometric consensus, not semantic recognition of
collectibles or players. Textureless/repeated scenes, large rotations, occlusion,
and insufficient persistent features can cause rejection or ambiguity. Unit
tests exercise translated images with a removed region and independently moving
features; successful correction in a real game has not been established.

There is no separate calibration routine or persisted sensitivity calibration.
Correction derives a local response from isolated demonstrated inputs;
telemetry explicitly reports `calibrationApplied: false`.

## Compatibility and resource bounds

Version-1 profiles remain readable, with optional independently versioned Macro
evidence. Edited blocking actions use the existing controller path. Visual
correction rejects an edited timeline or missing native capability; disabling
it allows input replay. Historical recordings cannot recover lost mouse deltas.
Teaching and other desktop modes retain their existing workflows. Existing
profile, recording, runner, and teaching tests passed; full GUI interaction was
not repeated in this continuation.

Recordings remain bounded to two minutes, with a 9,900-event capture threshold
and cleanup headroom inside the 10,000-event profile limit. High-rate devices
can exhaust this budget well before two minutes. Native capture queues at most
eight frames and retains at most 160 samples with an 8 MiB PNG budget. The GUI
manager accepts at most 90,000 bytes per frame and 6 MiB total PNG data; persisted
base64 images are limited to 8 MiB, with descriptors and events additional.
Desktop request bodies are limited to 24 MiB.

Screen copying/PNG encoding runs outside the raw-input message loop during
capture. Replay avoids per-edge screenshots and IPC. Polling omits repeated
Macro evidence where possible. Macro report history is bounded to 500 events
and 2,048 detailed timing samples per run, with at most 512 samples per native
segment. No new package dependencies or lockfile changes were introduced;
the implementation uses the existing `pngjs` dependency and Windows APIs.
CPU, memory, maximum-size profile storage, and game FPS were not benchmarked.

## Validation results

The continuation reran these checks successfully:

- `pnpm typecheck`.
- `pnpm build` across the workspace.
- `pnpm test:unit`: 36 files, 249 tests passed, including 14 Macro tests,
  29 desktop-runner tests, and 18 recording-manager tests.
- `pnpm desktop:setup`: Windows native helper and fixture compilation.
- `node --check` for `apps/bot-gui/public/desktop.js`,
  `packages/environment-windows/scripts/build-native.mjs`,
  `scripts/desktop-smoke.mjs`, and `scripts/macro-native-smoke.mjs`.
- `git diff --check`: no whitespace errors; Git's LF/CRLF notices are advisory.

The prior session already performed the bounded native Macro fixture check.
Its retained [results](../artifacts/macro-native-1789210093647/results.json)
record 407 completed edges over an 813 ms timeline, including 400 relative
mouse packets at 500 packets/second and overlapping movement/button holds.
Maximum lateness was 5.630 ms, mean 1.082 ms, and final 1.266 ms.
Cancellation, pause, geometry loss, and F8 stopped input and verified released
keys/buttons. Screenshot/raw-registration lifecycle validation retained five
320 by 240 images totaling 30,070 PNG bytes. This was synthetic input into
the owned Windows fixture, not a human demonstration or a real-game outcome.
It was not repeated because successful results already existed and native
source was not changed during this continuation.

The requested real Macro movement/camera reproduction remains unvalidated:
Roblox was not running when this continuation checked. The native result also
records that Roblox was unavailable. Earlier files under
`artifacts/roblox-validation-2026-09-12` concern teaching/local learning and do
not establish a result for this Macro implementation. No game success,
physical-device recording fidelity, or real-game visual correction is claimed.

## Changed files and Git state

The uncommitted implementation modifies 20 tracked files:

- GUI: `apps/bot-gui/public/desktop.html`, `desktop.js`;
  `apps/bot-gui/src/desktop-recording-manager.ts`, `server.ts`;
  `apps/bot-gui/test/desktop-recording-manager.test.ts`.
- Documentation: `docs/recording.md`.
- Player: `packages/agent-player/src/application/desktop-runner.ts`,
  `src/index.ts`, `test/desktop-runner.test.ts`.
- Environment contracts: `packages/environment-sdk/src/desktop.ts`,
  `recording.ts`.
- Windows: `packages/environment-windows/native/DesktopBridge.cs`,
  `DesktopFixture.cs`, `DesktopRecorder.cs`; `scripts/build-native.mjs`;
  `src/windows-session.ts`.
- Game contracts: `packages/game-sdk/src/desktop-profile.ts`, `index.ts`,
  `recording.ts`.
- Validation: `scripts/desktop-smoke.mjs`.

Eight new files remain untracked, including this report:

- `docs/macro-upgrade.md`.
- `packages/agent-player/src/macro/replay.ts` and `vision.ts`.
- `packages/agent-player/test/macro-replay.test.ts`.
- `packages/environment-windows/native/DesktopMacroCapture.cs` and
  `DesktopTimeline.cs`.
- `packages/game-sdk/src/macro.ts`.
- `scripts/macro-native-smoke.mjs`.

Nothing is staged. HEAD and branch are unchanged; no commit, push, PR, or
branch operation was performed. Build outputs and validation artifacts are
ignored by Git. All source changes remain uncommitted.
