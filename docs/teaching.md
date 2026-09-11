# Teach Bot: demonstration-guided visual behavior

For local demonstration learning without a provider, use [Local Learned](local-learned.md). Both modes reuse the capture/behavior library; **Learn locally** does not analyze with or call AI Vision. The AI procedure workflow documented below remains a separate optional mode. Local outcome/target/recovery annotations live in local knowledge and do not rewrite the AI procedure.

**Record Macro** saves exact input and timing for deterministic replay. **Teach Bot** saves visual demonstrations and asks a multimodal model to extract reusable guidance. **Start Bot** executes the macro or learned behavior you select. Manual recording/replay works without an AI account.

This is a working first implementation of demonstration memory plus a visual decision loop. It does not train a neural policy, and successful real gameplay has **not** been validated. Model quality, observation latency, and the game's acceptance of synthetic input determine practical results.

## Create and run a behavior

1. Run `pnpm desktop:setup` after updating native sources, then `pnpm gui`. Open `/desktop.html` on the printed localhost URL.
2. Refresh windows and select the target application. Use a private/owned test experience where automation is permitted.
3. Under **Teach Bot**, choose **Create a new behavior**, name it, and optionally describe the goal. For example: “Collect one red mushroom and verify the inventory increased.” An explicit stopping condition is better than an ambiguous “farm.”
4. Choose visible-pointer or relative/locked-camera mode. Set the recording start method/countdown in **Record Macro** above; teaching shares these controls. **Start teaching** or **Arm teaching hotkey** starts observation, never playback. F6 starts/pauses/resumes an armed demonstration; F9 stops it.
5. Perform a short successful example while the target stays visible and foreground. Pause briefly at meaningful before/after states so sparse sampling can capture them. Stop with F9 while success evidence is still visible. Returning to the GUI first pauses capture and may lose a brief final notification.
6. Select the demonstration, mark **Yes, succeeded**, **No, failed**, or **Not sure**, and explain any visible outcome or correction. Choose **Analyze demonstration**. No model is called until this step. Analysis sends selected images and input evidence to the configured provider.
7. Inspect **Learned procedure & demonstration evidence**. Each subtask has intent, entry/transition criteria, failure/recovery guidance, and source frame numbers. Open the original actions/metadata or screenshot gallery. Review the inferred goal and **Finish when** text, correct them, then **Confirm goal & completion / Save behavior**. A usable behavior needs at least one analyzed successful example and explicit goal/completion review.
8. Select **Selected learned behavior** under **Run selection**. Choose the target again if necessary, set the run/model bounds, then **Start Bot**. Button, countdown, and explicitly armed F7 starts work as with macros. Live status includes the current activity, visible evidence, input count, and model call count.

To correct a run: stop it, select the same learned behavior, and choose **Teach another example**. Demonstrate the correction from the troublesome state, label the outcome, analyze it, and review/save again. Earlier examples remain. After a server restart, choose the saved behavior and demonstration to analyze/retry; recording is never armed automatically.

Additional examples must use the same process name and camera mode. A process name is an application grouping, not a game identity: Roblox experiences and browser-hosted apps may share one process name. Give behaviors distinct names and select the appropriate one yourself.

## Configure the multimodal provider

There was no existing model-provider implementation in this repository. The new `VisualModel` port exposes only image/text JSON inference; it has no controller, shell, filesystem, browser, or network-tool access. The runtime remains provider independent.

The built-in **OpenAI Responses API** integration sends Base64 image inputs and requests JSON output, then strictly validates the returned procedure/action with Zod. It checks refusal, incomplete output, malformed JSON, response size, timeout, and HTTP failure. JSON mode itself is not a schema guarantee. This follows the official [image input contract](https://developers.openai.com/api/docs/guides/images-vision) and [JSON-mode guidance](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode).

Set environment variables in the terminal that launches the GUI. No credentials belong in a profile, goal, source file, or report. Select an image-input model with JSON-mode support that is available to your API account; the implementation deliberately does not select a model or price tier for you.

```powershell
$env:DESKTOP_AI_PROVIDER = 'openai'
$env:DESKTOP_AI_MODEL = 'gpt-4.1'
# Set OPENAI_API_KEY through your existing secret/environment mechanism.
pnpm gui
```

`DESKTOP_AI_API_KEY` overrides `OPENAI_API_KEY`. The key is used only in the server's Authorization header. Provider configuration is never persisted; public status includes only provider, model, timeout, and a configuration message. Provider bodies/network errors are not echoed into reports, and a response containing the configured key is rejected. Requests use `store: false`; this is not a claim about the provider's separate retention policies. Screenshots themselves can contain visible private information, so keep the target free of secrets.

The example uses [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), whose documented image input, Responses support and low-latency non-reasoning path fit an initial wiring test. It is an example, not an automatic default or a claim of sufficient gameplay competence. You can select a stronger compatible vision model for ambiguous tasks, subject to the observation-age and cost bounds.

An **OpenAI-compatible Chat Completions** adapter is also available for other vendors or locally served multimodal models:

```powershell
$env:DESKTOP_AI_PROVIDER = 'openai-compatible'
$env:DESKTOP_AI_BASE_URL = 'http://127.0.0.1:8000/v1'
$env:DESKTOP_AI_MODEL = 'YOUR_SERVED_MULTIMODAL_MODEL'
# Set DESKTOP_AI_API_KEY if that endpoint needs one.
pnpm gui
```

The endpoint must support image messages, `response_format: {type: "json_object"}`, and the generated JSON contract. “OpenAI-compatible” does not guarantee a particular model can follow the procedure/action protocol. URLs require HTTPS except on loopback; credentials, query strings, fragments, and HTTP redirects are rejected. A custom vendor adapter can implement `VisualModel` without changing the controller or behavior schemas.

Missing configuration is shown in the GUI and rejects intelligent start before binding native input. “Configured” means settings are present, not that a network/account health check passed. Analysis/provider failure retains the demonstration for retry. `.env` files are ignored by Git but **not automatically loaded** by the GUI; use inherited environment variables or your own environment loader. No paid provider call was made during implementation.

## What a demonstration captures

The native recorder remains the source of timestamped keyboard/button edges, sampled pointer positions, wheel events, and release boundaries. Teaching adds an opt-in screenshot queue on the same recorder thread and monotonic timeline. It does not open a second input controller or take over the user's keys.

- A baseline screenshot is captured before input hooks start. Subsequent frames are sampled near input changes and during quiet periods; a final frame is attempted before pause/stop while the target is still foreground.
- Active sampling uses `max(350 ms, recording duration limit / 150)`: 800 ms for the GUI's two-minute limit. Quiet sampling is about one second. These are nominal intervals; capture and scheduling add latency. This is **sparse state evidence**, not a guaranteed screenshot immediately before and after every input edge.
- Frames include their recorder time, capture timestamp, event index, held keys/buttons, window identity/client geometry, image hash, and local image path. Compare events between adjacent frame indices to inspect the before/action/after relationship. Hooks coalesce pointer movement as in macro mode; raw/locked-camera device deltas are not recorded.
- PNGs are scaled to at most 1280 pixels on their longest edge. The recording HUD is hidden for capture. Unchanged frames without intervening input are omitted; identical pixels around different inputs remain useful evidence of blocked actions.
- Limits: two minutes, approximately 2,000 input events, at most 158 native frames, and roughly 60 MiB of native image payload (the manager also caps retention at 160 frames/64 MiB). Exhausted budgets may leave later actions without images; the GUI frame count and manifest warnings help identify this. Prefer several short focused examples.

Focus/geometry changes pause input capture. Hidden, minimized, or replaced targets fail capture. Frames are accepted only for the selected identity; the recorder checks foreground and geometry around each screenshot. Capture reads visible screen pixels, so overlays can occlude game content. There is no DOM, process memory, private game API, executable injection, network manipulation, or anti-cheat bypass.

## Storage, learning, and multiple examples

Behaviors are versioned JSON files at `data/desktop-behaviors/<behavior-id>.json`. Each example references an immutable demonstration ID; reanalysis updates that example's derived guidance rather than replacing other demonstrations. Outcome labels/notes can be corrected. Behavior files include the reviewed goal, completion criterion, camera mode, application grouping, procedures, source IDs, and analysis model/provider names. They contain no provider credentials.

Evidence lives at `artifacts/desktop-teach-<demonstration-id>/demonstration.json` and `frames/<frame-id>.png`. The manifest contains the complete supported action trace, sparse frame metadata, outcome, and capture warnings. Completed demonstrations are persisted before model analysis. Graceful server shutdown finalizes active teaching; a process crash may leave only frame files. Both `data/` and `artifacts/` are already Git-ignored. Copy both directories to back up learned behavior and its evidence.

Analysis selects up to 12 frames, retaining endpoints, representative action transitions and coverage across the trace. One multimodal request receives these images plus the supported input trace, timing, goal, and outcome. It extracts visual target identity, subtask intents, preconditions, completion/failure cues, demonstrated recovery, uncertainties, and named low-level control mappings. Each subtask must reference valid selected frame IDs. Controls may use only demonstrated keys/buttons; Alt, Control and all function keys are excluded from learned controls in this first version. Ordinary macro controls keep their existing support.

Runtime memory uses the latest four analyzed successful procedures and latest two analyzed failed/uncertain procedures from the selected behavior. Failure examples are labeled as cautionary evidence. Two historical images from the latest successful example provide target/completion references. All older demonstrations stay on disk, but are not all sent on each turn. This is bounded behavior-specific memory selection, not a vector database or automatic merging of all examples. No model weights are updated. Preserving timestamped inputs and visual observations permits later dataset work, but sparse frames are not a ready-made high-rate behavioral-cloning dataset.

## Live execution, controls, and completion

Each decision receives the reviewed goal/completion, learned guidance, historical reference images, a before image from the previous action, a **fresh current screenshot**, and recent action/progress history. Historical coordinates are not used to dispatch inputs. The model grounds visible UI points in the current client image or selects a semantic learned control with a new bounded duration.

Available intelligent actions are named key/button holds, relative camera turns (with an optional demonstrated button modifier), current-image clicks/moves/drags, small vertical scrolls, and short waits. The controller expands each choice into at most eight native primitives and at most two seconds of requested duration; the GUI defaults to a 750 ms action limit. Relative deltas are bounded to ±300 per axis and scrolling to ±3 ticks. Camera turns/button holds/scrolls position the pointer at the current target center where needed before using native pointer ownership checks; this positioning is not a recorded route. Pointer-mode targets are chosen from the current image. Relative-camera behaviors reject arbitrary pointer clicks/drags and require learned controls or camera decisions.

Inputs remain held throughout a short local action without millisecond model calls. The runner releases all injected input before waiting on the model. It observes after the action, and combines verification of that action with selection of the next action in one model request. A fresh native capture/health check before dispatch guards target and geometry changes during reasoning. The configurable observation-age bound also rejects excessively late decisions; it cannot eliminate scene changes during model latency.

Completion requires model-reported visible evidence on two decision observations separated by a short wait, against the user-reviewed criterion. Executing an expected input never directly counts as success. Reaching action, call, recovery or wall-time bounds stops without verified success. This is model-based visual verification, not an independent game-truth oracle; it can still be wrong.

The policy retains recent actions and screenshots for progress evaluation. Unknown/no-progress observations count toward a stuck limit. Repeated identical actions have an additional bound, even if the model claims progress. The model can propose a different bounded recovery, but recovery attempts and total calls are limited. Stop and add a corrected example when the behavior cannot progress.

Malformed/oversized/unsupported model output and provider failures stop safely. Focus/geometry loss uses existing pause/resume handling; target loss and input failures fail closed. Pause clears pending completion confirmation. **F8**, GUI emergency stop, Stop Bot, cancellation, native watchdog/deadline, and held-input cleanup remain active. F8 also cancels analysis when the recorder service is running. Never assume closing the GUI tab stops the server's run.

## Latency and cost

No model calls occur during capture. Analysis normally uses one request with up to 12 images. Runtime normally uses one request per decision with up to four images (two demonstration references, previous before state, current state), plus a confirmation decision at completion. `verify` does not add another network request. Requests have no automatic retries.

Defaults: 30 model calls/run, 750 ms action limit, four unverified-progress decisions, two recoveries, 15-second maximum observation age, and a 45-second provider timeout. Run duration and action limits also apply. Configure provider timeout using `DESKTOP_AI_TIMEOUT_MS` (1,000–120,000) and output budget using `DESKTOP_AI_MAX_OUTPUT_TOKENS` (512–16,000; default 6,000). GUI intelligent limits are per start; when starting programmatically they can be carried in the profile's optional `learnedOptions` and `policyTimeoutMs`.

Calls, provider-reported input/output tokens, aggregate request latency, recovery count, model/provider and behavior ID appear in intelligent run state/report. `reports/learned-memory.json` preserves the behavior/options used by that run even if you later correct the saved behavior. There is no dollar-price estimate or token-based hard billing cap: pricing is model/provider specific, and a call can consume its full configured output budget. Reduce calls and use short focused demonstrations; do not send a video every game frame. A model slower than the observation-age bound fails safely. Increase that bound only for sufficiently static tasks or choose a faster model. Fast combat and continuously moving targets remain poor fits for this loop.

## Validation and limitations

Code-level tests cover schema/action bounds, live-target changes with fake model responses, semantic expansion, evidence references, multiple examples, progress/recovery/call limits, completion confirmation, stale decisions, malformed/refused/incomplete HTTP output, secret-safe errors, cancellation, timeout, target loss, and cleanup during partial actions. Persistence/orchestration tests cover capture versus macro separation, restart, provider-unconfigured recovery, and graceful shutdown. The GUI workflow is checked with mocked desktop/model responses. TypeScript, native compilation, workspace build, and the existing regression suite are also checked; see the [implementation and validation report](teaching-validation.md) for results and the complete file list.

No paid live-model analysis, real learning quality, Roblox gameplay, raw-input compatibility, or generalization to new game states has been validated. Windows `SendInput` reports dispatch, not whether a game accepted it. Locked/raw camera games may ignore synthetic input; no bypass is attempted. Models can misidentify objects, infer the wrong intent, confuse animation with progress, miss brief success notifications, or give incorrect completion claims. User review and varied demonstrations help but do not guarantee competence. Arbitrary code generation, heavyweight training, real-time tracking, cross-application tasks and automatic experience discovery are outside this version.
