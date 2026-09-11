# Record your actions, then replay them

**Record Macro** watches your input and creates an exact editable desktop configuration. **Start Bot** sends input using your run selection. Stopping a macro recording only creates a draft; it never starts playback. This workflow needs no AI. For learning a goal from screenshots, demonstrations and outcomes, use the separate [Teach Bot workflow](teaching.md).

## Start the GUI

From the repository root on Windows:

```powershell
pnpm install
pnpm desktop:setup
pnpm gui
```

`desktop:setup` compiles the native helper and requires the Windows .NET Framework compiler. `pnpm gui` builds the workspace and starts the local GUI. Open the printed URL, usually `http://127.0.0.1:5178`, and choose **Desktop automation**. Recompile with `desktop:setup` after changing native sources. See [desktop setup and safety](desktop.md) for platform requirements.

## Make your first recording

1. Open your target application, choose **Refresh windows**, and select its title/process/PID. Keep its client area visible. **Capture target preview** is optional.
2. In **Record Macro**, choose a start method:
   - **Button · start now:** click **Start Recording**. The helper requests target focus and begins when physical controls are released.
   - **Countdown:** set the recording countdown, then click **Start Recording**. The GUI and a small, non-activating overlay over the target show the countdown. Stop or discard cancels it.
   - **Arm recording hotkey:** click **Arm Recording Hotkey** once, prepare the target, then press **F6**. The configured recording countdown applies after the hotkey. Set it to zero for an immediate start after releasing F6.
3. Wait for **RECORDING**, then perform your actions normally. The overlay and GUI show elapsed capture time, event count, target and status.
4. Press **F6** to pause/resume, or use **Pause Recording** / **Resume Recording**. Release physical keys/buttons before resuming. Resume uses the configured recording countdown again. Time spent paused is excluded from the sequence.
5. Press **F9**, or click **Stop Recording**. The generated sequence opens under **Review & save**. Give it a name and choose **Save configuration**.

Moving focus to the GUI pauses capture, so its clicks are excluded. Focus changes, geometry changes and unsupported input pause recording with a reason. A disappeared, hidden, minimized or replaced target ends capture with an error; any captured prefix remains available for review. **Discard Recording** cancels capture and removes the draft, restoring the editor contents from before recording in the current tab. It does not delete an already saved configuration.

Recordings are bounded to two minutes and approximately 2,000 events. The limit can end capture automatically. Empty recordings show an error instead of creating a playable profile. Drafts are in memory until saved; closing the server loses an unsaved draft.

## What is captured

The recorder captures supported keyboard down/up transitions, held keys, application chords, overlapping keys, mouse positions, left/right/middle button down/up, clicks, dragging, and whole vertical/horizontal wheel ticks. A click is represented by a position and button down/up; a drag is button down, sampled movement, then button up. This keeps mouse and keyboard holds independent.

Supported keyboard names match the existing controller: letters, digits, Space, Enter, Tab, Escape, Backspace, Delete, arrows, Home/End/PageUp/PageDown, Shift/Control/Alt, and function keys except reserved controls. Left/right modifier variants are combined. OS keyboard repeat is ignored: one physical hold produces one down/up pair. Injected events and the registered control keys are excluded. OS switching/closing shortcuts and unsupported keys pause capture instead of being saved as gameplay.

Mouse movement is coalesced to roughly one sample every 50 ms, with the latest point flushed before keyboard/button/wheel transitions. Duplicate positions are omitted. Movement plus down/up edges preserves ordinary dragging without thousands of raw samples.

Capture uses Windows low-level input hooks on the helper's own message thread. They are installed only while recording, and only events whose foreground/point belongs to the selected target are retained. Nothing is injected into the target process. These are desktop hooks filtered to a window, not a private per-game input stream.

## Timing and coordinates

The existing version-1 profile `actions` array now accepts `delayBeforeMs` and `enabled`. `playback: "recorded"` schedules these gaps on a monotonic timeline. For example:

```json
[
  { "kind": "key-down", "key": "KeyW", "delayBeforeMs": 0 },
  { "kind": "key-down", "key": "Space", "delayBeforeMs": 800 },
  { "kind": "key-up", "key": "Space", "delayBeforeMs": 100 },
  { "kind": "key-up", "key": "KeyW", "delayBeforeMs": 500 },
  { "kind": "release-all", "delayBeforeMs": 0 }
]
```

W remains down while Space is pressed and released. Down/up actions are not converted into blocking, isolated holds. Pause/stop adds a release boundary and retains the quiet time before it. Recording release boundaries describe future playback cleanup; the recorder does not inject key-up events into your physical interaction. You must release your physical controls yourself.

Mouse points use the existing normalized client-area coordinates (0–1 in JSON; 0–100% in the editor). Borders and title bars are excluded. A window can move between recording and playback: the controller translates each point against its current client rectangle, including monitor offsets and DPI. Resizing may change the application's layout, so normalized coordinates cannot guarantee the same UI element. Movement/resizing/DPI changes during capture or playback pause the session for explicit recovery. Window handle, PID and process start time identify the selected target; saved configurations do not persist a target handle.

## Edit, save and load

Open **Edit sequence / create manually**. Events are paged in groups of 25. You can delete, move up/down, duplicate, insert waits, change keys/buttons/coordinates/durations, edit each delay, and enable/disable events. Disabled events retain their timing gap. Deleting or reordering an event moves/removes its delay with it; inspect matching down/up pairs after edits. All-disabled sequences and malformed actions are rejected when saving/starting.

For down events with a matching enabled release, **Hold until matching release (ms)** adjusts the release event's preceding delay. It refuses to move the release across intervening events; edit those delays or reorder explicitly when needed. An inserted Wait adds its own duration. **Recorded timing** honors recorded gaps; **Fixed interval after actions** ignores recorded gaps and uses the manual interval setting.

**Save configuration** replaces a configuration with the same name. **Save a copy** creates a distinct name. Load either through **Saved configuration**. Files remain in `data/desktop-profiles/`, and bundled examples remain in `profiles/desktop/`. Manual creation, screenshot point picking and reusable behaviors remain available. Behaviors keep their existing 32-action limit; recorded gaps become bounded waits when saving a behavior. Save longer recordings as configurations (up to 4,096 events after editing).

## Start playback separately

Select the target and saved configuration, then use **Start the bot**:

- **Button · start now** starts the current configuration with no configured countdown.
- **Countdown** uses the **Bot start countdown** setting after **Start Bot**.
- **Arm bot hotkey** snapshots the current target/configuration. Click **Arm Bot Hotkey**, position the target, then press **F7**. Its release triggers the configured bot countdown. Editor changes after arming do not change that pending run; stop and re-arm to apply them.

**Stop Bot / cancel start** disarms a pending hotkey, cancels a countdown, or stops an active run. **Pause Bot** releases injected holds. **Resume Bot** requests target focus and fresh geometry; recorded playback restores logically held controls before continuing. Restoration attempts count toward the action limit. A partially dispatched action is never blindly repeated.

Recording and bot execution cannot run or be armed together. The GUI disables conflicting controls; the server serializes commands and the native session mutex prevents competing record/playback owners. The activity display distinguishes human recording, armed starts, and bot playback. Saving a recording does not start the bot.

## Loops and delays

Choose **Run once**, **Loop N times**, or **Loop until stopped**. The bot status shows the current loop and finite total. **Delay between loops** applies after each finished repetition. The bot start countdown runs only once, before the entire run. Pausing during a loop delay preserves its remaining time. Held inputs are released between loops.

Until-stopped loops still obey the action-count and wall-clock duration limits. Raise those settings deliberately when you want more repetitions; neither can be disabled (maximum 10,000 attempts / one hour). Countdown, pauses and loop delays all count toward the wall-clock duration. Stop Bot or **F8** ends any loop. An action cap may cut a loop short, which is not counted as a completed loop.

New recordings default to once. Existing JSON profiles without a `loop` field retain their prior repeat-to-limits behavior. The GUI displays those as until-stopped with safety limits. Loop configuration is additive:

```json
{ "loop": { "mode": "count", "count": 3, "delayMs": 2000 } }
```

## Shortcuts and safety

Open **Global shortcuts** to change Record (**F6**), Start bot (**F7**) and Stop recording (**F9**). Recording's key also pauses/resumes. **F8 remains fixed emergency stop** for both modes. F1–F11 except F8 are selectable; duplicate keys are rejected. F12 is reserved by Windows for debugging. Registration conflicts are shown in the GUI; choose another key. F8 registration failure also prevents enabling the new control service.

Settings are saved in `data/desktop-hotkeys.json`; armed starts never survive a server restart. Registration happens after an explicit recording/bot/settings action, not merely opening the page. Registered shortcuts stay active until the GUI server closes. They cannot be used as gameplay inputs in configurations launched through these GUI controls. Hotkeys only start explicitly prepared/armed work, so pressing F6/F7 while idle does not unexpectedly take control.

Playback reuses the existing native `SendInput` controller, window checks, F8 watchdog, heartbeat, attempt/time limits, held-input cleanup, screenshots and reports. Focus/geometry loss pauses; target identity loss or native failure stops input. Stop, cancellation, failure and controller exit release injected keys/buttons. F8 is checked independently of Node by the playback helper. The recorder also observes F8 and cancels queued starts. No software can guarantee cleanup if the native helper itself is forcibly killed or Windows stops processing input.

Legacy profiles default to a 5.5-second continuous held-input limit. Recordings use a configurable maximum of 60 seconds; capture pauses a continuous held episode at 59 seconds. A held episode lasts until *all* keys/buttons are up. Individual blocking Hold/Wait/Drag actions retain the five-second bound. Recording does not synthesize releases for physically held user input.

## Limits to check in your application

- Playback is best-effort desktop timing, not frame-accurate hardware replay. IPC, native dispatch and OS scheduling add latency. Delays over 250 ms behind schedule resynchronize instead of issuing a catch-up burst. Recorded mode captures screenshots at loop boundaries, not between input edges; its per-action unchanged-screen guard is unavailable. Fixed-interval mode keeps that guard.
- Absolute sampled pointer movement does not reproduce raw-input or locked-cursor camera movement. Relative mouse actions remain available for manual editing. Game sensitivity, acceleration, pointer capture and synthetic-input acceptance need application-specific testing.
- Extra mouse buttons, gamepads, touch, Unicode/IME, unsupported keyboard keys and fractional/high-resolution wheel deltas are not captured. Whole wheel deltas outside ±20 ticks pause capture. Left/right modifiers and physical scan-code distinctions are not preserved.
- Popup windows can be separate targets. Secure/elevated/protected/exclusive-fullscreen surfaces remain subject to the existing desktop controller limitations. The overlay is intended for ordinary visible windowed applications.
- Windows can silently remove low-level hooks if their callback times out. Callbacks avoid file/network work, but recording under a heavily stalled desktop still needs inspection. The hooks, shortcut ownership, overlay and actual game acceptance have only been compiled/reviewed in this change, not exercised against a real application.
- Closing the browser tab does not stop capture/playback. Stop with F9/F8, reopen the GUI, or exit the server; recording and run bounds remain active.

See [code-level validation and your manual checklist](recording-validation.md). Windows shortcut and hook behavior follows Microsoft's [RegisterHotKey documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey), [keyboard-hook contract](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), and [mouse-hook contract](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc).
