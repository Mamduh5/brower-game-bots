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
