# ADR 0002: Workspace Package Boundaries

## Status

Accepted

## Decision

The repository uses a `pnpm` workspace with separate packages for contracts, runtime, environments, agents, reporting, persistence, and game plugins.

## Rationale

- Clean dependency direction is enforceable through package manifests and code review.
- Browser, game, and reporting concerns stay isolated.
- Shared contracts become explicit and easier to stabilize.

## Consequences

- Cross-package imports must go through public entrypoints.
- Shared packages must remain intentionally small and stable.
- Package proliferation is acceptable when it protects a meaningful architectural seam.
