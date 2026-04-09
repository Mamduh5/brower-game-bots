# Contributing

## Change Safety Policy

- Never rewrite across multiple modules without a clear architectural reason and an explicit migration path.
- Preserve public contracts unless a migration is intentional, versioned, and documented.
- Use adapters instead of special-casing shared runtime for one environment or game.
- Prefer extension over invasive modification.
- Add tests before altering core behavior in shared runtime, contracts, persistence, or reporting.
- Treat shared runtime as critical infrastructure.

## Dependency Direction Rules

- `apps/*` may depend on workspace packages.
- `packages/runtime-core` may depend on shared contracts, config, and logging abstractions, but not Playwright.
- `packages/environment-playwright` may depend on `environment-sdk` and Playwright, but not agent packages.
- `games/*` may depend on `game-sdk`, `environment-sdk`, `runtime-core` ports, and shared contracts only.
- `packages/agent-player` and `packages/agent-tester` may depend on runtime, game, and environment contracts, but not Playwright directly.
- `packages/reporting` may depend on contracts and evidence models, but not browser internals.
- No circular dependencies are allowed.

## Review Standard

When changing critical packages, verify:

- contract compatibility remains intact
- package boundaries remain clean
- tests cover the changed behavior
- game-specific and browser-specific logic did not leak into shared modules
