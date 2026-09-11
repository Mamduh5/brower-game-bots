# Local Learned continuation: 2026-09-12

**FAILED: egg not obtained.** No egg was obtained or hatched by this continuation. Existing inventory badges and passive currency changes do not establish acquisition by the learner.

## Starting point

Continued the existing uncommitted working tree on `main`; did not restart the implementation. Inspected the full Git status/diff, existing scripts/tests, the local memory envelope, the 36-frame demonstration, earlier native capture results, and Roblox attempt screenshots/telemetry.

Already present: ordered short movement-chord extraction; the no-recovery-example selection fix; candidate/assessment diagnostics; native recorder readiness, warning and queue-backpressure fixes; repeated teaching-session tests; a separate actual-demonstration deletion route/UI with deletion recovery and filesystem tests. These changes were preserved. The pre-existing untracked `e.value)` file was left untouched.

The saved artifacts differ from the handoff's summary:

- `improved-region` used **25 transitions**, sent four W holds (248/600/300/300 ms), and recorded one heuristic positive result followed by three uncertain results. It did not acquire an egg.
- `annotated-target` subsequently used **8 transitions**, sent **zero inputs**, and paused on missing/ambiguous targets. This was the actual persisted starting point.
- There are **35 adjacent frame pairs**, of which **25** have supported extracted controls. Applying the original target annotation globally discarded another 17 pairs.

Evidence: `artifacts/roblox-validation-2026-09-12/continuation/analysis.json` and `starting-memory.json`, plus the original `improved-region` and `annotated-target` folders.

## Findings and implementation

### Target identity and localization

The annotation at frame 15, approximately (0.4, 0.68), contains the small egg/nest and part of the changing interaction prompt. It is not a stable isolated appearance. Old training matched this patch to the white creature around (0.26, 0.58) in frames 13/14 and to that creature in frame 9. The derived target motion therefore mixed different objects. Whole-scene similarity could not repair that association.

The matcher now subtracts each RGB channel's mean when calculating spatial correlation. Previously, shared green/background color contributed to apparent texture correlation. A uniformly colored patch is also rejected even when its channels have different values. Acceptance remains **0.78**, with ambiguity margin **0.045**; neither threshold was lowered.

Targets now use a separate image of at most **288 x 216**, while scene features remain the original **96 x 72 / 168 values**. Saved patches remain 9 x 9 RGB. Search covers scales **0.5, 0.8, 1, 1.25, 1.6**, uses denser sampling for small patches, and refines distinct positions at each scale. A regression exposed coarse-search aliasing at different pixel offsets; the refinement now retains candidates at each scale instead of letting one location/scale occupy all refinement slots. Crops snap to the detail sampling grid. Imports check that a marked patch can be uniquely localized near its annotated source position.

Original source-patch retrieval improved from approximately **84%** after the correlation-only change to **100%** with detail sampling/refinement. That is source-image localization, **not generalization or gameplay success**. The previously accepted wrong-object matches in inspected frames 9/13/14/16/17/32 are rejected. On the saved live starting image, the original patch still scores only about **62%**. A read-only comparison of an egg-centered patch from frame 14 retrieves the actual small egg correctly in frames 13/14 at about **100%**, but still fails in the distant live view. The comparison annotations were not installed as game-specific policy rules.

The next real correlation-only attempt paused with no input (best target **61.3%**). The later detail attempt paused with no input because its changed, zoomed-out view had nearest-scene similarity **59.1%**. The richer representation has not demonstrated improved live navigation.

Evidence: `continuation/spatial-correlation.json`, `target-comparison.json`, and the `continuation-spatial` / `continuation-detail` run folders.

### Current target relationship, action duration and progress

Directional/button controls with targets now require the live target position to be within 0.12 normalized image distance of the demonstrated starting position. Clicks continue to relocate to the live match. This rejects using a learned direction when the target is on an unsupported part of the screen; it does not invent a new movement direction.

The configured duration limit now applies to the **sum of timed actions in a skill**, preserving the proportions of changing key chords. Previously each hold was limited separately. Fast demonstrated target motion further shortens the skill toward at most 0.035 normalized displacement, with a 120 ms lower bound for that additional motion-based limit. Existing shorter demonstrated actions remain shorter. Fresh dispatch validation updates the authoritative target position as well as scene state.

Target-motion alignment alone no longer earns positive credit. The observed target must also move closer to its demonstrated endpoint. Moving beyond that endpoint and increasing distance is negative even if motion has the same direction. Unexpected disappearance is negative when the demonstration kept the target visible. Diagnostics expose the before/after match, endpoint distances, alignment, total action duration and rejection score/margin.

Synthetic tests verify approach, overshoot, loss, unsupported target positions and compound duration limits. **These branches were not exercised by an accepted grounded movement in Roblox**, because the available annotation does not cover the live starting state. The region-only comparison made three short movements, each uncertain, and received no positive reward. Do not claim that overshooting in Roblox has been solved.

### Recovery

The no-recovery-example bug remains fixed and is extended to inapplicable recovery examples. After three non-progress results, a retrieved recovery is preferred only if it passes scene, target, action-history and confidence checks. If none qualifies, ordinary supported candidates remain available. The configured no-progress/loop limits still stop the run; applicable recovery attempts still consume the recovery budget. Weak ordinary evidence can still pause earlier for its own reason.

Tests cover both no recovery examples and an unrelated recovery example. The last real run reached three uncertain results with zero recovery attempts; it ended on fresh-observation validation, not an empty recovery-only candidate list. Final pause/reset telemetry clears transient `noProgress`; the saved polling telemetry records the observed maximum of three.

### Persistence and diagnostics

Memory format 2 marks the detail sampling representation; format 1 is read and migrated while legacy patches retain their original sampling plane. Reimport replaces patches using extractor version 4. Old software fails closed on format 2. Future-version rejection, checksums and backup behavior remain tested. No dependencies were added.

Training returns total pairs, retained/merged counts and skipped counts by reason. Counts below are **per import**, not the cumulative lifetime `skipped` counter.

## Transition accounting

| Configuration | Total pairs | Usable/retained | Skipped by reason |
| --- | ---: | ---: | --- |
| Starting extractor, region only | 35 | 25 | 9 no supported input; 1 mixed pointer/movement |
| Starting persisted annotation | 35 | 8 | Above 10 + 17 missing/ambiguous targets |
| Final extractor, region only | 35 | 25 | 9 no supported input; 1 mixed pointer/movement |
| Final original annotation | 35 | 2 | Above 10 + 23 missing/ambiguous targets |

No duplicate merges or capacity skips occurred. The final annotated transitions are frame 15's E hold and frame 30's independently grounded pointer click. They provide no supported navigation from the live start.

The nine no-supported-input pairs start at frames 0, 11, 12, 24, 27, 28, 29, 31 and 34. Frame 33 contains mixed pointer/right-button and movement evidence. Pointer-camera behavior was not converted into guessed relative camera control. Frame 13 contains only an 11 ms captured E tail/start segment; frames 14/15 contain longer E holds. The demonstrated interaction spans frame boundaries. Release between learned actions can interrupt such interactions, but this was not diagnosed as a live interaction failure because acquisition was never reached. Hatching was not optimized.

Evidence: `continuation/final-analysis.json`, `final-training.json`, `final-state.json`. The original region and target annotation are restored; final persisted memory contains 2 transitions, 2 target patches, no recovery examples, and no completion detector. Starting memory and temporary region-only run memories remain in artifacts.

## Real Roblox attempts

All attempted runs resolved the live Roblox window through enumeration, used Local Learned with no model/provider, and used a 30-second / 35-input budget, maximum action setting 600 ms, minimum confidence 0.62, maximum no-progress 6, and maximum recoveries 2. No recovery was executed. No acquisition/hatch was established in any row.

Paths below are relative to `artifacts/roblox-validation-2026-09-12/`.

| Attempt / evidence folder | Starting variation | Learner change | Actions / decisions | Egg obtained? | Hatched? | End reason |
| --- | --- | --- | --- | --- | --- | --- |
| `continuation-baseline` | Safe-zone edge, original close camera | Resumed 8-state annotated memory | 0; nearest scene 73.0%; targets rejected | No | No | Missing/ambiguous target |
| `continuation-spatial` | Same area, changing spawned objects | Per-channel spatial correlation; reimported 2 states | 0; scene 70.4%; best target 61.3% | No | No | Target below 78% |
| `continuation-detail` | Substantially zoomed-out view; no prior learner inputs | Detail plane, scales/refinement, relationship/budget/scoring fixes | 0; nearest scene 59.1% | No | No | Scene below 65% |
| `continuation-region-control` | Physical controls held | Temporary region-only comparison, 25 states | 0; no decision | No | No | Native release-physical-controls safeguard |
| `continuation-region-retry` | Safe-zone edge, changed zoom/objects/another avatar | Same 25-state comparison after controls released | W 248/112/112 ms; all uncertain; scene 72.6% initially, 84.8% maximum | No | No | Fresh visual validation rejected next dispatch; subsequent inspection found social UI |

Each folder contains request/profile, polling telemetry, final state and copied run report/screenshots. Newer probe runs also preserve starting memory and the actual pre-stop reason in `ending.json`; generic cleanup otherwise changes the final reason to “Stopped by user.” Aggregate numbers are in `continuation/attempt-summary.json`.

The last run's starting screenshot already contains a chat feed; its later screenshot shows chat and Quick Words UI. These were discovered during post-run image inspection. Only three W holds were dispatched, with no chat submission action. The visual guard stopped the next dispatch, and no further Roblox inputs were sent after inspection. This exposed a gap in the test helper's starting-screen review. It now separates screenshot-only preflight from `--run`, requires a recent preflight for the same live target, and instructs the operator to inspect it first. This is **operator review**, not automatic semantic detection of payment/social UI. The revised helper was syntax-checked but not rerun after the stop condition.

## Remaining limitation

The current compact template representation does not maintain reliable object identity across the scale, perspective and prompt changes in this demonstration. The live camera/target arrangement also differs from the demonstrated approach. Global target annotation currently requires the same appearance across the whole demonstration, leaving almost no applicable controls. Region-only retrieval restores movement coverage but still cannot infer how to approach the current target. The game's visible objects and UI changed between attempts without learner actions; the cause of those external changes was not determined.

Further lightweight work is plausible: varied short approach demonstrations, annotation scoped to task phases, multiple verified appearances of one target, temporal object tracking, and visual calibration of directional actions. The existing single-template nearest-state architecture is approaching its practical ceiling for this sparse 3D task. A full local language/vision model is not established as necessary, but threshold tuning or longer movement will not supply missing directional/object evidence.

## Capture, deletion and validation

- **Code-level:** final TypeScript project-reference check passed; full workspace build passed. JavaScript syntax and Git whitespace checks passed. New local regressions cover target matching, position support, endpoint overshoot/loss, compound budgets, recovery applicability, import accounting and format migration.
- **Mock/integration:** 31 files / **227 tests passed**, excluding existing browser `.integration.test.ts` suites. After the final duration-rounding edge case was tightened, the relevant 3 files / **40 tests** and typecheck passed again. Included worker/filesystem tests exercise real local serialization/storage with synthetic images. Repeated teaching tests finalize three independent sessions on one recorder; deletion tests verify source/reference removal, journal recovery, independent other-demo preservation, backup behavior, and the difference from Forget locally.
- **Native/desktop:** native C# compilation passed. The first compile was blocked by the running GUI helper's executable lock; after checking that run/recording state was inactive, the GUI/helper were restarted and compilation succeeded. Real native screenshot capture and guarded Local Learned dispatch occurred in this continuation. No new full fixture/watchdog smoke suite was run. The earlier preserved real recorder report contains three independent sessions with five screenshots each on the same recorder; it has zero human gameplay inputs because injected test inputs are intentionally excluded. This establishes repeated screenshot capture, not fresh physical-input capture validation in this continuation.
- **Real Roblox:** five attempts above, four reaching policy/control evaluation and one rejected before decision; three total movement inputs. No acquisition, interaction-stage or hatch success. No cloud inference, API fallback, game-memory access, injection, network manipulation or route code was added. Existing F8/focus/identity/geometry/cleanup/cancellation/watchdog/budget safeguards remain in place.

## Important files and Git

Continuation changes: `packages/agent-player/src/local/{vision,engine,training,memory,policy}.ts`; `packages/agent-player/test/{local-learning,local-persistence}.test.ts`; read-only scripts `local-continuation-inspect.mjs` / `local-target-evidence.mjs`; the existing `roblox-local-attempt.mjs` probe; local-learning documentation and this report.

Preserved prior changes: GUI desktop UI/server/teaching/recording managers and their tests; `desktop-demonstration-deletion.ts`; environment recording contracts; native `DesktopRecorder.cs`; earlier desktop/Roblox probe scripts. No new package dependencies or model assets.

No commit, push, PR, repository rename, or branch change. Everything remains uncommitted on `main`.
