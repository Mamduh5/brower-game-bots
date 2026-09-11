# ADR 0006: Demonstration-guided desktop behavior

## Status

Accepted for the first visual teaching implementation. Research inspected September 2026; no upstream code or model weights were imported.

## Existing boundaries and decision

The repository already has a safe native `DesktopSession`, macro recorder, versioned desktop profiles, artifact storage, a `DesktopPolicy` seam in Player Agent, and a localhost GUI. Browser Player/Tester and game plugins use separate contracts. There was no model-provider implementation to reuse.

Extend the recorder with opt-in sparse screenshots on its own clock/target. Put demonstration/behavior schemas in `game-sdk`, inference/learning/policy in `agent-player`, and local persistence/workflow orchestration in the GUI application. Reuse `DesktopRunner` and its controller safety checks. Keep deterministic macros and saved profiles compatible. A vendor-neutral `VisualModel` port supports Responses and compatible Chat Completions without adding an SDK dependency. Game-specific intent remains data in the selected behavior; no hardcoded mushroom/Roblox policy is introduced.

## Research and fit

| Work | Relevant idea and implementation decision | Dependencies, license, platform and maintenance fit |
| --- | --- | --- |
| [Tencent/UI-Mate](https://github.com/Tencent/UI-Mate) | Human traces distilled into subtask workflow guidance, with live visual grounding. Adopt evidence-linked procedures, not coordinate playback. | Apache-2.0 with third-party exceptions. Its demonstrated protocol uses a dedicated checkpoint; accepting a prompt is not proof another model follows it. Python/vLLM serving and large model requirements are unnecessary dependencies for this TypeScript first version. Native Windows client support is relevant, but importing a separate desktop app would duplicate existing controls. A recent research release also needs independent local validation. |
| [BAAI-Agents/Cradle](https://github.com/BAAI-Agents/Cradle) | Combine observation, reflection, memory and curated controls. Adopt recent visual/action history and bounded semantic controls. | [MIT code](https://github.com/BAAI-Agents/Cradle/blob/main/LICENSE), Python/Conda plus model/OCR tooling and environment-specific setup. Its game adapters may pause games to tolerate model latency. Reusing that stack would add substantial dependency and maintenance burden; our loop instead reports its real-time limitations and stays within current Windows safeguards. |
| [OpenAI VPT](https://github.com/openai/Video-Pre-Training) | Genuine behavioral cloning learns model weights from demonstrations; inverse dynamics helps label video. Preserve aligned evidence for possible later datasets, but do not call prompt memory behavioral cloning. | [MIT code](https://github.com/openai/Video-Pre-Training/blob/main/LICENSE), Minecraft/MineRL and PyTorch-specific models. The README documents pinned older PyTorch reproducibility constraints. This is a training research stack, not a portable Windows/TypeScript controller or a few-example solution. |
| [Microsoft UFO²](https://github.com/microsoft/UFO/blob/main/ufo/README.md) | Windows agent uses demonstration memory and validates speculative actions. Adopt bounded memory selection and validation at decision boundaries. | [MIT project](https://github.com/microsoft/UFO), Python 3.10+/Windows 10+, UIA/Win32/COM and a broader evolving orchestration stack. UIA is valuable for ordinary applications but rendered games often expose little useful structure. Full speculative multi-action plans are a poor first fit for a latency-sensitive game controller; keep one short intent per observation. |

These are design inferences from the cited projects, not reproduced benchmark results. No license obligations from copied code or dependencies were introduced.

## Model contract and input mechanism

Use [Responses image input](https://developers.openai.com/api/docs/guides/images-vision) with explicit [JSON-mode validation](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode), no hosted computer-use tools, generated executable code, or raw model-to-controller access. JSON mode provides transport compatibility; local schemas remain authoritative. A compatible Chat Completions adapter is useful for vendor choice, but serving and model capability must be verified by the user.

Existing native relative movement uses documented [MOUSEINPUT relative deltas](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput). Retain pointer ownership and geometry checks. It is not raw device injection, and there is no claim every locked-camera game will accept it.

## Consequences

- One multimodal analysis per demonstration produces inspectable procedure memory. Runtime uses current screenshots plus bounded recent examples/history. Model latency and cost remain material.
- Sparse screenshots are practical for short demonstrations and later inspection. They are not complete video nor guaranteed before/after captures for each input edge.
- Explicit user review resolves ambiguous goals and success cues. Multiple examples retain individual provenance rather than silently replacing a previous solution.
- Model completion is checked on another observation. It remains fallible visual judgment. Action/time/call limits do not imply task success.
- Native input, focus, cancellation, emergency stop, cleanup, reports and game/plugin boundaries remain authoritative.
- No guarantee of general gameplay intelligence follows from deterministic tests; users must validate actual model behavior in permitted test experiences.
