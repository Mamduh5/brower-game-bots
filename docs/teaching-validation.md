# Teach Bot implementation and validation report

## Delivered behavior

The desktop GUI now offers exact macro recording, visual teaching, and explicit macro/learned run selection. Teaching records sparse visual states plus supported human input; a real configurable multimodal HTTP provider extracts evidence-linked procedure memory. The learned `DesktopPolicy` combines this memory, current screenshots, previous state and action history to select small bounded controls, verify progress, attempt limited recovery, and confirm completion visually. No foundation policy is trained and no fixed mushroom/gameplay behavior is hardcoded.

The [operating guide](teaching.md) covers the complete workflow, provider setup, capture timing/budgets, storage, correction, multiple demonstrations, controls, model usage and limitations. The [research decision](adr/0006-demonstration-guided-desktop-behavior.md) records the UI-Mate, Cradle, VPT and UFO² investigation and fit/licensing/dependency decisions.

## Checks performed

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed across the workspace |
| `pnpm build` | Passed across all workspace packages/apps |
| `pnpm desktop:setup` | Native C# helpers compiled successfully |
| `node --check apps/bot-gui/public/desktop.js` | Passed |
| `pnpm test` | **187 tests passed in 32 files**, including the existing browser Player/Tester integration tests |
| `git diff --check` | Passed |
| Playwright GUI check with mocked desktop/model API responses | Passed: teaching request, outcome selection, analysis display, completion correction, learned start, macro start, no page errors |

The GUI check used a headless browser and no native inputs or paid model calls. Its local script/screenshot are in ignored `output/playwright/`; the unit/integration log is in ignored `artifacts/teaching-validation/tests.log`. The temporary test browser and GUI server were closed.

New automated checks exercise current-image target changes with deterministic fake model responses, semantic control expansion, malformed/out-of-bounds/unknown controls, evidence provenance, frame selection, multiple examples, repeated uncertainty, stuck/recovery/model-call bounds, completion confirmation/reset, stale decisions, cancellation, provider timeouts, HTTP failures, refusal/incomplete output, credential-safe errors, target health before completion, action-budget termination, and cleanup after partial held-input batches. Manager tests verify teaching does not generate or start a macro, persistence/restart, provider-unconfigured recovery, interlocks during analysis, target grouping, path validation and shutdown finalization.

## Left for manual validation

No live paid multimodal inference, actual demonstration quality/generalization, Roblox gameplay, real teaching hotkeys/capture timing, or locked/raw-camera acceptance was tested in this implementation pass. Native sources were compiled, but the disruptive native fixture smoke suite was not rerun. Prior fixture validation documented elsewhere is not evidence for this new teaching capture path.

Recommended manual sequence: teach a short permitted target interaction; inspect baseline/action/final frames; label and analyze it with your configured model; correct completion; start from a changed target position/camera angle; inspect decisions; try F8/pause/focus loss; add a correcting demonstration and rerun. Use an owned/private/test experience where automation is permitted.

Known limits: sparse frames can miss fast transitions or exhaust image budgets; model progress/completion judgments can be wrong; a slow response can exceed the observation-age bound; only recent bounded example memory is sent at runtime; learned controls exclude Alt/Control/function keys; process names do not identify individual Roblox experiences; synthetic input/raw camera compatibility is game dependent. The model does not receive a game-truth API, and tests cannot establish real gameplay competence.

## New files

- `packages/game-sdk/src/teaching.ts` — versioned demonstration, procedure, behavior, review and run-limit schemas.
- `packages/agent-player/src/vision/visual-model.ts` — vendor-neutral port, OpenAI Responses/compatible Chat HTTP adapters, environment configuration, bounds and safe errors.
- `packages/agent-player/src/vision/demonstration-learning.ts` — bounded evidence selection, visual procedure extraction and demonstrated-control/provenance validation.
- `packages/agent-player/src/vision/learned-desktop-policy.ts` — semantic decisions, live visual memory, completion/progress/recovery logic and native action expansion.
- `apps/bot-gui/src/desktop-teaching-manager.ts` — local evidence/behavior store, teaching lifecycle, outcome labeling, analysis and review.
- `packages/agent-player/test/learned-desktop-policy.test.ts` — learning/policy tests.
- `packages/agent-player/test/visual-model.test.ts` — multimodal provider tests.
- `docs/teaching.md` — practical operating guide.
- `docs/adr/0006-demonstration-guided-desktop-behavior.md` — research and implementation decision.
- `docs/teaching-validation.md` — this report.

## Modified files

- `packages/environment-sdk/src/recording.ts` — opt-in visual teaching options and frame-drain port.
- `packages/environment-windows/native/DesktopRecorder.cs` — sparse native screenshot capture with recorder timestamps, target checks and budgets; teaching HUD label.
- `packages/environment-windows/src/windows-session.ts` — validated native frame transport.
- `packages/game-sdk/src/desktop-profile.ts` — optional learned behavior, policy timeout and learned run options.
- `packages/game-sdk/src/index.ts` — public teaching exports.
- `packages/agent-player/src/application/desktop-runner.ts` — bounded local batches, policy metadata/telemetry, fresh target checks, pause reset and unverified limit termination.
- `packages/agent-player/src/index.ts` — public visual policy/provider exports.
- `packages/agent-player/test/desktop-runner.test.ts` — feedback safety regression coverage.
- `apps/bot-gui/src/desktop-manager.ts` — resolve reviewed learned behavior/provider before native binding.
- `apps/bot-gui/src/desktop-recording-manager.ts` — share recorder/hotkeys/interlocks, retain separate teaching state and finalize evidence.
- `apps/bot-gui/src/server.ts` — localhost teaching list/analyze/review/cancel API routes.
- `apps/bot-gui/public/desktop.html` — separate macro, teaching and run-selection controls.
- `apps/bot-gui/public/desktop.js` — teaching workflow, outcome/review, evidence gallery and intelligent status.
- `apps/bot-gui/public/desktop.css` — teaching forms/gallery presentation.
- `apps/bot-gui/test/desktop-recording-manager.test.ts` — teaching lifecycle/persistence/interlock tests.
- `README.md`, `apps/bot-gui/README.md`, `docs/desktop.md`, `docs/recording.md` — updated entry points and capability descriptions.
- `.gitignore` — ignore secret environment files and local browser-validation artifacts.

No package dependencies were added. Native build outputs, test artifacts, data and GUI-check artifacts remain ignored. Nothing was committed or pushed, no pull request was created, and the repository was not renamed. All source/documentation changes remain uncommitted for inspection and manual testing.
