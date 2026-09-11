# 0007: Local visual imitation with bounded contextual experience

Status: implemented; real-world quality awaits user validation.

The repository already has a guarded native session, a sparse teaching recorder, a pixel-only `DesktopPolicy`, and per-run artifacts. Reuse those contracts and teaching evidence. Do not convert local learning into a macro, replace the controller, or instantiate `VisualModel` for this mode.

## Research and alternatives

Research consulted primary project documentation on 2026-09-12. Cost/install judgments below are engineering assessments for this repository, not measured benchmarks of the alternative libraries.

| Approach | Maintenance/licensing/interoperability | Fit and decision |
| --- | --- | --- |
| [OpenCV template matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html) | Current OpenCV 4.x documentation; normalized correlation and difference methods. OpenCV ≥4.5 uses [Apache-2.0](https://opencv.org/license/). Windows native and JS/WASM options require additional distribution/binding choices. | Appropriate local grounding. Implement a small bounded multiscale RGB correlation/error search in TypeScript rather than importing the entire vision runtime. Store small patches, no model weights. |
| [OpenCV ORB](https://docs.opencv.org/4.x/d1/d89/tutorial_py_orb.html) | Binary keypoints, oriented descriptors and image pyramids; established CPU-oriented technique within maintained OpenCV. | Better potential rotation/scale tolerance, but often sparse evidence on tiny UI targets; native/WASM packaging, descriptor matching and robust geometric estimation add scope. Not installed. |
| [Lucas–Kanade / optical flow](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html) | Maintained OpenCV algorithms for estimating motion between images. | Useful for tracking at close time intervals; existing sparse teaching frames, intervening camera movement and target reacquisition make flow alone insufficient. Reacquire templates on each observed skill result; no continuous tracker in this version. |
| [sharp/libvips](https://sharp.pixelplumbing.com/install/) | Actively maintained Node image pipeline with Windows prebuilt packages; sharp [Apache-2.0](https://github.com/lovell/sharp), libvips LGPL-2.1-or-later. Native artifacts are smaller than a model runtime but add installation/platform considerations. | Strong future option if full-size PNG decoding dominates measured cost. Avoid adding a native dependency before that evidence. |
| [pngjs](https://github.com/pngjs/pngjs) | Mature MIT-licensed pure JS PNG library, already resolved at v7 in the workspace. Smaller scope/slower release cadence than OpenCV or sharp; no native build or GPU. | Promote the existing resolved dependency into agent-player runtime dependencies. Decode only bounded PNGs in a Node worker. No new third-party implementation/model is imported. |
| [Vowpal Wabbit contextual bandits](https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Contextual_bandits_and_Vowpal_Wabbit.html) | Active online-learning project, [BSD-style license](https://github.com/VowpalWabbit/vowpal_wabbit/blob/master/LICENSE), native core and Python tooling; Windows/Node integration adds packaging and model lifecycle work. | Action/reward statistics are relevant, but this task lacks trusted environment rewards and safe unrestricted exploration. Use auditable smoothed per-context outcome counts over demonstrated actions; do not claim contextual-bandit regret guarantees or general RL competence. |
| [Corrective imitation / DAgger](https://proceedings.mlr.press/v15/ross11a.html) | Primary research on collecting supervision under the learner's induced state distribution. Technique reference, no software dependency. | Supports collecting human recoveries where the bot actually fails. Append corrective demonstrations and retrieve them by current state. This is not a full DAgger implementation or its theoretical guarantee. |

Compact grid/histogram features provide interpretable approximate state retrieval with no learned embedding model. A bounded linear scan of 1,024 prototypes avoids a nearest-neighbor database/dependency and its persistence/index lifecycle. It is intentionally approximate and cannot distinguish all semantically different states.

## Decisions and consequences

Use an explicit `local` profile mode, separate worker, standalone versioned knowledge files and shared behavior IDs. Preserve original v1 behavior/demonstration schemas and their AI procedures. The new profile field is additive; macro/AI budgets retain their previous bounds. The native bridge's absolute deadline ceiling increases to 24 hours, with the same monotonic clock and watchdog enforcement. Existing callers still send their smaller budgets.

Extend `DesktopPolicy` with optional pause, checkpoint, close, local evidence-budget and fresh-observation validation hooks. The runner retains input ownership and releases before policy work. Worker communication is bounded and cancellable; the worker has no session handle. Future teacher contributions can use the evidence import seam, but no teacher invocation/fallback exists.

Atomic checksummed two-generation JSON is sufficient for this explicitly bounded knowledge model and remains inspectable. The existing SQLite run repository serves browser runs and would require new lifecycle/coupling for worker-local knowledge; do not rewrite that system. Enforce bounded model counts, file sizes, caches and report retention instead of storing screenshots as experiences. Keep source demonstrations as a separate user-owned archive.

The UI must call the value a match/evidence confidence, show uncertainty and pause, support human correction, and avoid implying that a sent input proves success. Visual completion and online rewards are heuristics that require user validation in each task. This choice prioritizes transparent, local, bounded behavior over broad semantic recognition.
