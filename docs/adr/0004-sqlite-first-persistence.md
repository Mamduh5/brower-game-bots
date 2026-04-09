# ADR 0004: SQLite-First Persistence With Postgres-Compatible Boundaries

## Status

Accepted

## Decision

Phase 1 uses SQLite as the local-first persistence adapter while repository contracts remain storage-agnostic and compatible with a future Postgres adapter.

## Rationale

- Local debugging, artifact correlation, and iterative development are the immediate priorities.
- SQLite has low operational overhead for a greenfield foundation.
- Repository interfaces already separate runtime behavior from storage implementation.

## Consequences

- SQL schema stays simple and append-oriented.
- JSON payloads are stored in SQLite as serialized text for now.
- Future Postgres adoption should happen by adding a new adapter package, not changing runtime contracts.
