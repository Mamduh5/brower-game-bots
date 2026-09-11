# Local Learned implementation and code validation

This page records the initial implementation checks. The subsequent real Roblox continuation and current failure result are documented in [Local Learned continuation validation](local-learned-continuation-validation.md). Its results supersede the initial "not performed" statements below.

Implemented in the working tree on 2026-09-12. No commit, push, pull request, branch creation/switch or repository rename was performed.

## Checks actually performed

- `pnpm typecheck`: passed.
- `pnpm build`: passed across the workspace. Subsequent final TypeScript edits also passed the root project-reference typecheck/build.
- `pnpm exec vitest run --exclude '**/*.integration.test.ts' --reporter=dot`: **31 files, 213 tests passed**. The excluded existing integration files launch real browsers. The included new worker/service tests use synthetic files and no native controller.
- `pnpm desktop:setup`: native C# compilation passed. This compiles the bridge and fixture executable; neither was launched.
- `node --check apps/bot-gui/public/desktop.js`: passed.
- `git diff --check`: passed. Git reports the workspace's existing LF/CRLF normalization warnings, not whitespace errors.

The added tests cover approximate state similarity, current-location click grounding, missing/ambiguous targets, PNG bounds, important regions, demonstration reuse/idempotency, safe skill extraction, failures, shared action scores, online updates, completion confirmation, unknown/stuck/recovery handling, bounded runtime memory, reset/corrections, checksums/version rejection, backup recovery, exclusive writers, worker persistence, cancellation, controller cleanup/pause contracts, bounded report evidence, local duration bounds and scoped artifact retention. These tests do not establish gameplay competence.

A code-only microbenchmark generated a synthetic 1920×1080 PNG (1,303,275 bytes) and ran three iterations in a separate Node process. Median decode/features: **83 ms**; one target search: **6.8 ms**; 1,024 feature comparisons: **2.3 ms**. Reported JS heap after the fixture workload was 7,046,440 bytes, which excludes external image buffers and is not a long-run memory estimate. This was not a real screenshot, browser session, native fixture test or soak test. The production telemetry measures current vision/decision latency and heap/RSS independently.

**Not performed:** Roblox testing; real game or desktop testing; native interactive/fixture smoke tests; manual GUI interaction; Playwright, GUI or browser E2E; live provider testing; paid model calls; long-running soak tests or real 10-hour runs. The [manual checklist](local-learned.md#your-manual-checklist) belongs to the user.

## Changes

New files:

- `packages/game-sdk/src/local-learning.ts`: local options and annotation contracts.
- `packages/agent-player/src/local/vision.ts`: bounded PNG decoding, compact features and target matching.
- `packages/agent-player/src/local/training.ts`: evidence-aligned bounded action extraction and import.
- `packages/agent-player/src/local/engine.ts`: contextual selection, progress, completion, recovery and online statistics.
- `packages/agent-player/src/local/memory.ts`: schemas, limits, reset and checksummed durable storage.
- `packages/agent-player/src/local/worker.ts`: serialized worker jobs, writer lease and checkpoints.
- `packages/agent-player/src/local/policy.ts`: cancellable worker client and DesktopPolicy adapter.
- `apps/bot-gui/src/desktop-local-manager.ts`: local teaching/inspection/correction/reset orchestration.
- `apps/bot-gui/src/desktop-local-retention.ts`: completed-local-run retention.
- `packages/agent-player/test/local-fixtures.ts`, `local-learning.test.ts`, `local-persistence.test.ts` and `apps/bot-gui/test/desktop-local-manager.test.ts`: synthetic fixtures and code-level tests.
- `docs/local-learned.md`, this report and `docs/adr/0007-local-learned-desktop.md`: practical guide and researched decisions.

Modified files:

- `packages/game-sdk/src/desktop-profile.ts`, `src/index.ts`, `test/desktop-profile.test.ts`: additive local mode/options and local-only long budgets.
- `packages/agent-player/src/application/desktop-runner.ts`, `src/index.ts`, `test/desktop-runner.test.ts`: policy pause/checkpoint/close/visual validation hooks and bounded local artifacts. Existing macro/AI report event retention remains unchanged.
- `packages/environment-windows/native/DesktopBridge.cs`: native deadline ceiling of 24 hours; existing watchdog and held-input limits remain enforced.
- `apps/bot-gui/src/desktop-manager.ts`, `desktop-recording-manager.ts`, `server.ts`: separate local start and serialized local operations.
- `apps/bot-gui/public/desktop.html`, `desktop.js`, `desktop.css`: mode selection, annotation, local learning/inspection, recovery takeover, limits and reset UI.
- `packages/agent-player/package.json`, `apps/bot-gui/package.json`, `pnpm-lock.yaml`: explicit runtime dependencies on the already-resolved `pngjs@7.0.0` and `zod@3.25.76`. No new resolved package versions, native vision runtime, model weights or GPU dependency.
- `README.md`, `apps/bot-gui/README.md`, `docs/teaching.md`: local entry points and AI/local separation.

## Practical limits

This learns approximate local relationships, not language semantics, 3D reasoning or general gameplay strategy. Progress/confidence/completion are heuristic. Sparse demonstrations, hard camera changes, repeated textures and ambiguous targets can require further teaching. It deliberately skips unsupported compound inputs/drags. Stalls pause after bounded recovery attempts; there is no automatic AI fallback. Worker computation, knowledge, transient screenshots and logs have explicit bounds. Original teaching archives and unfinished crash artifacts remain user-managed, and real 10+ hour behavior remains unverified.

The worker's JavaScript heap is limited to 128 MiB old generation / 32 MiB young generation; external PNG buffers and the GUI/native process are additional memory. Ordinary errors or worker-limit failures stop input through the existing controller cleanup path. Restart the app after a worker crash to release a same-process stale writer lock. See the guide for checkpoint durability limits and recovery/reset behavior.
