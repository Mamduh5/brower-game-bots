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

## Real-Game Smoke Path

An additional real-game plugin is available at `games/play2048-web`:

- `gameId`: `play2048-web`
- tester profile: `profiles/play2048-web/tester.smoke.yaml`
- default target URL: `https://play2048.co/` (override via `GAME_BOTS_PLAY2048_URL`)

CLI command:

- `game-bots run-tester-2048`

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