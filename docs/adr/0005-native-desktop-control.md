# ADR 0005: Native Windows control alongside browser environments

## Decision

Add additive desktop contracts to `environment-sdk`, profile/behavior schemas to `game-sdk`, a Windows adapter package, and a bounded desktop runner in `agent-player`. Keep browser `EnvironmentSession`, `GameSession`, Player/Tester policies and all existing game integrations unchanged. Reuse workspace boundaries, Zod validation, `ArtifactStore`/`FsArtifactStore`, and the local HTTP GUI/static serving instead of duplicating infrastructure.

The existing environment requires browser navigation, selectors and clickability probes. The existing run phase model has no paused phase and the browser GUI replay normalizes game-specific summaries. Pretending desktop actions are browser actions or widening every browser implementation would be a breaking change without functional benefit. A desktop-specific application loop is therefore appropriate; it does not replace the existing runtime or SQLite browser workflows. No public contract migration is needed because the new interfaces/exports are additive.

A small checked-in C# helper uses Win32 `SendInput`, window enumeration/identity/geometry, per-monitor DPI awareness and visible `CopyFromScreen`. Node communicates through bounded JSON-line RPC, without shell interpolation or evaluating profile text. A detached helper owns actual held state, cancellation safety checks, a single-session mutex, F8 and a watchdog. Compiling it with the Windows .NET Framework avoids Node native addon ABI/toolchain dependencies. The tradeoff is maintaining a small Windows-only adapter and testing it on real Windows.

The policy boundary exposes screenshots, a user goal, recent history, bounded decisions, verification, and configured behaviors. No AI provider is inferred from the browser's rule-based policies. Deterministic automation works without model cost; future providers must supply actual reasoning and verification. Pixel differences are diagnostic evidence, not semantic success.

## Research reviewed on 2026-09-11

These are design references, not imported dependencies. Repository metadata is a point-in-time signal, not a promise of support. No source code was copied.

| Reference | Relevant idea and fit assessment |
| --- | --- |
| [Cradle](https://github.com/BAAI-Agents/Cradle) | Separate game skills, input and screenshot reasoning. MIT; GitHub metadata last push 2024-11-07, not archived. Its Python/model ecosystem and game-specific integrations would add substantial setup/runtime cost here. Retain small physical/composite skill separation, not its full framework. |
| [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) | Operator/runtime separation; distinct browser and computer operators. Apache-2.0; last push 2026-08-05, not archived. The larger desktop/model stack has its own configuration/deployment needs. Keep typed provider/control boundaries rather than introduce another GUI or agent host. |
| [Qwen-CUA](https://github.com/xlang-ai/Qwen-CUA) | Screenshot history, runtime validation and replay evidence separated from model decisions. Apache-2.0; last push 2026-08-26, not archived. Newly released model/runtime, with inference cost and setup not justified for deterministic control. Keep bounded history and validated outputs; no model weights or provider installed. |
| [Voyager](https://github.com/MineDojo/Voyager) | Reusable skills and iterative verification. MIT; last push 2024-04-03, not archived. README describes Windows 11 testing, but its Minecraft/Mineflayer/mod/Python stack does not provide the required generic native-input boundary. Do not reuse its game-internal execution path. |
| [OpenAI computer-use integration](https://developers.openai.com/api/docs/guides/tools-computer-use-integration#repeat-the-computer-use-loop) | Application-owned action handler and screenshot loop, with explicit cancellation and step/time limits. A future API adapter would incur provider cost and require model configuration. This work implements the application boundary without installing an SDK or selecting a model. |
| [Microsoft UFO / UFO2](https://github.com/microsoft/UFO) | Windows/application control and hybrid observation choices. MIT; last push 2026-09-09, not archived. Its broader Python/agent orchestration is unnecessary here. Preserve the stronger browser structured observations alongside native screenshots. |
| [nut.js](https://github.com/nut-tree/nut.js) | Cross-platform input and screenshots are relevant; OCR/image/window features involve additional providers and distribution/build/licensing choices. Its documented installation and addon surface do not remove the need for independent crash cleanup or pinned-window safety. No dependency or paid binary added; no assumption made about an unverified addon license. |

Win32 specifics were checked against Microsoft's documentation for [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput), [MOUSEINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput), and [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow). Input is subject to integrity restrictions, relative movement differs from absolute virtual-desktop coordinates, and foreground requests can be denied. These remain explicit limitations rather than targets for workarounds.

## Consequences

Browser behavior remains stable and portable. Native runs require an interactive Windows desktop and additional real-OS validation. The new GUI mode supplies useful deterministic configuration immediately; model-backed autonomy, visual target recognition, semantic farming rules, gamepad support and a native replay index remain future integration work. Roblox is a manual validation target, with no special behavior in the shared runtime.
