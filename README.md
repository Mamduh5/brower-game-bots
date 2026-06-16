# Browser Game Bots

Production-oriented modular monolith for browser-first game automation with two specialized agents:

- `Tester Agent`: QA-oriented execution, evidence capture, issue finding, and report generation.
- `Player Agent`: gameplay-oriented decision-making that reuses the same runtime and environment foundation.

## Foundation Principles

- Single repository, `pnpm` workspace, TypeScript-first.
- Browser automation is isolated behind an environment adapter.
- Shared runtime is critical infrastructure and must remain game-agnostic.
- Reporting is evidence-driven and must not be intertwined with control flow.
- New games are added through plugins under `games/*`, not invasive edits across shared packages.

## Workspace Layout

- `apps/*`: entrypoints and operational tooling.
- `packages/*`: reusable runtime, contracts, adapters, and agent packages.
- `games/*`: game-specific integrations built on the shared SDKs.
- `docs/adr/*`: architectural decisions that define the repo's long-lived constraints.

## Current Scope

This repository currently implements the Phase 1 / Phase 2 foundation:

- workspace wiring
- stable contracts and schemas
- runtime skeleton and ports
- browser environment boundary
- agent package boundaries
- reporting skeleton
- filesystem artifact storage
- SQLite-first persistence adapter

Gameplay strategies, advanced tester heuristics, OCR/ML workers, and external issue publishers are intentionally deferred.

## Real-Game Smoke Paths

Primary real target plugin:

- package: `games/cat-and-dog-web`
- `gameId`: `cat-and-dog-web`
- tester profile: `profiles/cat-and-dog-web/tester.smoke.yaml`
- default target URL: `https://cat-and-dog-p6qd.onrender.com/` (override via `GAME_BOTS_CAT_AND_DOG_URL`)
- CLI command: `game-bots run-tester-cat-and-dog`

Example real target plugin:

- package: `games/play2048-web`
- `gameId`: `play2048-web`
- tester profile: `profiles/play2048-web/tester.smoke.yaml`
- default target URL: `https://play2048.co/` (override via `GAME_BOTS_PLAY2048_URL`)
- CLI command: `game-bots run-tester-2048`

The existing Wordle fixture path remains the default for `run-player` and `run-tester`.

## Guard

In addition to the architecture work, follow these non-negotiable refactor guards:

Refactor guard:
- inspect current structure first
- preserve existing working behavior unless a change is explicitly necessary
- do not rename/move files casually
- do not rewrite large working modules just to match style preferences
- do not introduce breaking changes to public contracts without a migration note
- if a module can be wrapped by an adapter, do that instead of rewriting internals
- prefer incremental extraction over big-bang refactor
- any core contract change must be accompanied by tests and a migration explanation
- if uncertain, keep stable code and add seams around it

Implementation strategy:
- identify what can remain
- identify what must move
- identify what must be wrapped
- identify what must be redesigned from scratch
- propose smallest high-quality path to the target architecture

## Run command

pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e

pnpm run dev
pnpm run dev -- run-player
pnpm run dev -- run-tester
pnpm run dev -- run-tester-cat-and-dog

### More Command

pnpm run dev -- run-player-cat-and-dog
pnpm run dev -- run-player-cat-and-dog --max-attempts=15 --strategy-mode=explore
pnpm run dev -- run-player-cat-and-dog --max-attempts=5 --stop-on-win=false

pnpm run dev -- run-player-cat-and-dog --difficulty=impossible --max-attempts=5 --strategy-mode=explore --stop-on-win=false
pnpm run dev -- run-player-cat-and-dog --difficulty=impossible --max-attempts=5 --strategy-mode=explore --stop-on-win=false --visible
pnpm run dev -- run-player-chess-com --opponent=computer --max-moves=80 --visible
pnpm run dev -- run-player-minesweeper-online --difficulty=beginner --max-moves=200 --visible

## Bot GUI

Start the local live runner and completed-run replay dashboard:

```powershell
pnpm run gui
```

Open the printed URL, usually `http://127.0.0.1:5178`. The Live Runner panel can start Cat-and-Dog, Chess.com, or Minesweeper Online with selectable game, browser mode, and bounded run settings. Browser mode defaults to Headless; select Visible to launch a real Playwright-controlled browser window while the bot plays.

Chess.com support is computer-only. The runner navigates to `https://www.chess.com/play/computer`, refuses online/live human matchmaking signals, records board FEN/moves/screenshots, and uses `chess.js` to choose from real legal moves. The current policy is a basic explainable evaluator: it scores legal moves for checkmate, check, captures, material, simple capture safety, opening development, center control, king safety, and promotion. It records the selected move score/reason plus top candidate moves; it does not use Stockfish.

Minesweeper Online support targets Beginner 9x9/10 mines. It opens `https://minesweeperonline.com/`, selects Beginner through the visible Game options UI, parses only visible DOM cell classes, applies deterministic reveal/flag rules, and records bounded-risk guesses when no deterministic move is available.

The dashboard scans `artifacts/**/reports/02-player-attempt-summary.json`, `artifacts/**/reports/02-chess-com-player-summary.json`, and `artifacts/**/reports/02-minesweeper-online-player-summary.json`. It can load a manually entered summary path such as:

```text
artifacts/<runId>/reports/02-player-attempt-summary.json
```

It displays run id, game/profile ids, requested and runtime difficulty, max attempts/moves, stop-on-win, strategy mode, attempt outcomes, final HP and damage, wind, wall state, selected/planned/prepared shot values, shot history, Minesweeper move/board timelines, planner/adaptation/deduction reasons, final notes, artifact paths, and screenshot paths. See `apps/bot-gui/README.md` for the replay scope and future human-vs-bot seam.
