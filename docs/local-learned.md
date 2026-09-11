# Local Learned

Local Learned uses your demonstrations, current visible pixels and accumulated local results to choose short actions. **API required: No.** It does not load a language model, download weights, contact an inference service, or fall back to AI Vision. It is a conservative visual imitation learner. Real Roblox testing has not completed egg acquisition or hatching; see the [continuation report](local-learned-continuation-validation.md).

| Mode | Decision source | Requirements |
| --- | --- | --- |
| Macro | Exact configured inputs and timing | Native controller; no AI |
| Local Learned | Similar visual states, grounded targets, demonstrated controls and result statistics | Local demonstration screenshots; no API |
| AI Vision / Teach Bot | Existing multimodal procedure analysis and live visual decisions | Separately configured AI provider |

## Teach and start

1. Run `pnpm install`, `pnpm desktop:setup`, then `pnpm gui`. Open `/desktop.html` and select your target window.
2. Under **Teach a behavior**, name the behavior, choose pointer or relative camera mode, and start teaching. Demonstrate a short task slowly enough to capture before/after evidence. Use F9 to stop. The existing capture limit is two minutes, 160 frames, about 2,000 inputs and 64 MiB per demonstration.
3. Select the demonstration and its outcome. Under **Local Learned**, click **Learn locally from selected demonstration**. This uses the outcome as a local label without changing the separate AI procedure. A failure label marks the last usable transition as negative; earlier steps remain uncertain. A success label supplies weak successful-action priors and a possible visual completion anchor.
4. Alternatively, **Import all demonstrations locally** reuses saved Teach Bot demonstration labels and screenshots, including examples that have never been AI-analyzed. It requires no AI review. Import-all uses the original saved labels; use selected-demo training for local label corrections. Reimporting identical evidence is idempotent. Reimporting a changed label replaces that demonstration's local transitions and associated runtime statistics.
5. Select **Local Learned · no API** in Start Bot. Start with a short action/time budget. The default is continuous operation; enable **Finish after learned success is confirmed** for a finite task. **Set 12-hour local safety budget** sets 43,200 seconds and 250,000 input actions; it does not start the bot. Local hard limits are 24 hours and 1,000,000 input actions. Macro and AI modes retain their one-hour / 10,000-input limits.

Multiple examples contribute independently. Demonstrate varied positions, successful approaches, failures and recoveries. The learner does not understand natural-language goals, notes, object names or the AI completion text. Those remain useful documentation for you and AI Vision.

## Optional visual correction

Open **Learned procedure & demonstration evidence** and view the screenshots. Enable **Click a demonstration image to mark its target**, then click a textured object. The marked patch is 12% of each image dimension. The API accepts a target size between 5% and 30% when a smaller/larger crop is needed. Each supported transition searches for that appearance in its own current image. Click actions otherwise automatically crop the demonstrated interaction point. Targets near image edges, flat patches and ambiguous duplicate matches are rejected.

Use a frame's **local success evidence** button to identify completion. It must be visually distinct from its preceding action state. A settling frame up to two seconds later can serve as completion if no additional input intervened. If no discriminative supported transition reaches the success frame, no completion detector is created; the success label alone is insufficient.

An optional normalized important-region rectangle excludes irrelevant UI from state features. Set it before importing a behavior; changing it requires a full local reset and reimport. Target matching still searches the whole client image. Clear pending annotations before switching to another demonstration.

## Decisions and learning

- Each PNG becomes a 96×72 RGB image, then a 168-number feature vector: an 8×6 colour grid plus channel histograms. Similarity tolerates small cell shifts and modest colour variation. Client coordinates avoid dependence on desktop window position.
- The learner retrieves at most 12 nearby demonstrated transitions and scans at most four distinct target patches per decision. A separate image of at most 288×216 preserves target detail. A 9×9 RGB patch uses per-channel spatial correlation and colour error at scales 0.5, 0.8, 1, 1.25 and 1.6, with denser search for small targets and refinement at each scale. Acceptance still requires score ≥0.78 and margin ≥0.045 over a spatially distinct match. Imports also verify the marked source location. Duplicate-looking objects can cause a help request.
- Controls are inferred from frame-aligned held input and timed events: short key chords, relative camera adjustments, relative-mode button holds, pointer clicks and scrolls. These are action candidates, not an ordered recording. Mixed changing key chords, pointer drags, reserved keys, frame gaps over 1.5 seconds and unsupported/ambiguous evidence are skipped and counted.
- Clicks use the newly matched target position. Other annotated controls require a current target position within 0.12 normalized distance of the demonstrated starting position. Unsupported target relationships pause instead of inventing directions. The controller receives bounded actions only; historical click coordinates are never used as a fallback.
- Ranking combines visual similarity, target evidence, smoothed success/failure statistics and a recent-repeat penalty. Displayed confidence is a **heuristic evidence score, not a calibrated probability**. Default minimum confidence is 0.62. Weak accepted skills have a 300 ms total timed-action budget; the normal maximum is 800 ms (configurable 100–1,000 ms). Changing chords retain their duration proportions. Fast demonstrated target motion can shorten the budget further to require another observation.
- The result is compared with the demonstrated resulting appearance and, when annotated, the direction and endpoint of target motion. Motion in the right direction earns credit only when it also approaches the demonstrated endpoint; passing it and moving farther away is negative. Unexpected loss of a target that remained visible in the demonstration is negative. Nearly unchanged scenes are neutral; unexplained animation is uncertain and earns no success credit. Every dispatched skill gets a result update; observation-only waits do not.
- Smoothed priors survive noisy observations. Runtime statistics apply locally to visually similar states; each context's effective count is decayed above 200 samples and its ranking influence is capped. Runtime state deduplication uses similarity ≥0.98. This is a contextual action scorer, not an unrestricted reinforcement-learning planner.
- Success requires a sufficiently distinctive labeled endpoint appearing in two successive observations, with a fresh visual check before accepting completion. It is reported as a **learned success appearance**, not semantic proof of an inventory change or task reward. In continuous mode the learner then looks for another applicable transition; it does not blindly restart a route.

## Stuck, takeover and recovery

Three decisions without useful evidence make matching recovery demonstrations eligible. If no retrieved recovery passes the current visual/confidence checks, ordinary supported actions remain eligible until a configured stop condition. The default allows two recovery attempts and six decisions without progress. Repeated state/action patterns, oscillation, lost targets, unknown states or insufficient action confidence pause with released input. Recovery uses demonstrated short actions chosen against the current state; it is not a timed recovery macro. A successful recovery can reset the failure budget.

Click **Stop & teach a recovery**. This closes/checkpoints the bot, releases its lease, retains the behavior selection, starts a teaching countdown of at least three seconds, and marks the next local example as a recovery. Perform the correction, stop with F9, label its result and choose **Learn locally**. **Start Bot** later starts a fresh guarded run from the current screen. Ordinary Pause/Resume remains available for inspection; to alter the learner or record a correction, stop the run first.

Under **Correct or forget**, inspect/select a learned example and mark its most recent observed runtime result successful/failed, or disable an incorrectly recognized state. Human result corrections add four bounded votes; they do not erase other evidence. Wrong-state correction disables that exemplar. Text notes alone do not alter visual inference.

## Persistence, inspection and reset

Compact knowledge lives in `data/desktop-local/<behavior UUID>.json`, with a `.bak` generation. It stores versioned features, target patches, source demonstration IDs/annotations, bounded action candidates, outcome priors, recovery flags, runtime context statistics and lifetime counters. Format 2 loads format 1 while preserving legacy patch sampling; reimport builds the richer patches. Older app versions reject format 2. It does not store full runtime PNGs. Startup loads this representation directly; it does not replay raw demonstrations.

A dirty learner checkpoints every 30 seconds or 25 completed skill experiences, whichever occurs first, and on pause/clean shutdown. Writes use a checksummed envelope, flushed temporary files and atomic rename, preserving a validated previous generation. A torn primary file can recover from backup, visibly reported in statistics. Future format versions fail closed instead of being silently downgraded. If both generations are corrupt, **Reset to demonstrations** rebuilds from original evidence. A crash can lose the current uncheckpointed interval; a power/storage failure is not an absolute durability guarantee.

A per-behavior writer lock prevents concurrent runs/edits across app instances. Dead-process locks are reclaimed on next open. After an unexpected worker crash while the parent app remains alive, restart the app before reopening its behavior. Save failures stop decisions instead of silently continuing without persistence.

**Refresh learning statistics** shows transition/target/demo counts, recovery examples, runtime experience, positive/negative/neutral/uncertain outcomes, success appearances, unknown/stuck counts, checkpoint/recovery status and disk size. The inspector lists source frame IDs and lets you select examples. Running telemetry additionally includes confidence, vision/decision latency, retrieval count, worker heap and total process RSS in the state API/report. RSS covers the whole GUI process, not just the learner.

- **Clear runtime learning** removes runtime contexts/statistics while keeping demonstrations and disabled exemplar corrections.
- **Reset to demonstrations** rebuilds all original examples, preserves available local outcome/recovery/visual annotations, clears runtime learning and reenables exemplars. It also reimports previously forgotten demonstrations. If both generations are corrupt, saved local annotations cannot be recovered; original labels are used.
- **Forget selected demonstration locally** removes its local contributions only. Explicitly importing it again teaches it again.
- **Full local reset** clears local knowledge and both save generations. Original screenshots, demonstrations and AI analysis remain intact.

## Long sessions and storage bounds

Per behavior: at most 1,024 demonstrated transitions, 256 runtime contexts, 64 target appearances and 100 source demonstrations. Repeated transitions within an example merge; runtime states merge by similarity. At capacity, oldest ordinary demonstration states are evicted before terminal/recovery states; runtime contexts evict least recently updated entries. Unreferenced patches/statistics are pruned. Counters expose eviction/skipping; adding evidence beyond these bounds does not imply it was all retained.

Each checkpoint file has a 12 MiB hard limit: primary plus backup ≤24 MiB, with at most two additional temporary files during writes. Oversize checkpoints fail safely. Original teaching evidence has its existing separate per-demo bounds and is never automatically deleted; users creating many behaviors/demonstrations must manage that deliberate archive.

The worker keeps one current reduced image, at most two training frame grids and 12 recent decision states. PNG decoding rejects inputs over 16 MiB or 16 megapixels. CPU work is off the controller/HTTP event loop; no GPU or inference runtime is needed. Each skill is followed by observation, normally after a 650 ms settle interval; an additional fresh screenshot preserves the existing dispatch guards. Identical hashes reuse features. Increase the observation interval for slower tasks. Large original PNGs still incur native capture/decoding cost.

Local reports retain 500 events, 100 visible log lines and 20 recent history entries, with dropped-event counts. Runtime evidence is sampled at most once every five seconds and duplicate images are skipped. At most 16 immutable images / 16 MiB are kept plus one overwritten latest image (bounded by the 16 MiB screenshot limit). Starting another local run keeps only the four newest completed local run folders, leaving room for the new run: five total after completion. This does not touch teaching, macro, AI or unfinished/corrupt report folders. Crash-leftover folders require deliberate cleanup; they are not deleted by guessing ownership/completion. Learned knowledge is independent of report retention.

## Safety and limitations

Window identity, foreground focus, geometry, F8, cancellation, pause/resume, held-input release, input counts, native heartbeat/watchdog, maximum hold duration and a wall-clock deadline still belong to the existing controller. The deadline also applies while paused. Changing window geometry requires inspection/resume and fresh observations. No process memory, hooks into games, injection, network manipulation or bypass techniques were added. The existing recorder continues using its supported ordinary input capture mechanism.

This does not understand object semantics, map geometry, depth, language goals or arbitrary strategy. Large rotations, scale changes beyond the small template range, occlusion, particles, repetitive textures, fast motion, tiny UI details, cursor overlays and raw-input games may cause misses or false matches. A selected important region and varied examples can help but offer no competence guarantee. It cannot infer complex drags or accurately credit every step in sparse, complex demonstrations. Whole-task success labels are weak supervision for intermediate steps. Runtime rewards remain heuristic and can be wrong; use corrections/reset.

The `DesktopPolicy` interface remains the future teacher seam: a separately authorized teacher could contribute bounded demonstrations/transitions later. **Automatic AI fallback is not implemented.** Existing AI Vision code remains separate and its fake-provider regression tests remain in the code-level suite.

## Your manual checklist

1. With API keys absent, record/import a short demonstration and start Local Learned; independently check macro and AI selections.
2. Vary the target position and window location; confirm current-target clicks and safe pauses on ambiguity, focus/geometry changes and target loss.
3. Verify outcome labels against actual task results, including false success, missed success and neutral animation; try visual annotations and corrections.
4. Cause a stall, teach a recovery to the same behavior, then check whether it applies only in a similar state.
5. Exercise F8, Stop, Pause/Resume and interruption during holds/camera/button actions. Check all controls are released.
6. Restart the GUI/Windows and inspect retained learning. Try clear-runtime, reset, forget, and backup recovery on disposable copies.
7. Increase duration gradually. Watch CPU, RSS, disk, latency, unknown/stuck counts and checkpoint timestamps before a 10+ hour run.

Real desktop capture and bounded Roblox runs were performed in the [continuation](local-learned-continuation-validation.md), without completing the egg task. Browser/GUI E2E, live provider and long-soak testing were not added in that pass. See also [design/research](adr/0007-local-learned-desktop.md) and [initial code validation](local-learned-validation.md).
