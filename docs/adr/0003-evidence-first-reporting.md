# ADR 0003: Evidence-First Reporting

## Status

Accepted

## Decision

Reports and issue candidates are built from run events and immutable evidence references rather than from inline agent control flow.

## Rationale

- Findings need auditability and reproducibility.
- Execution logic should not be polluted by formatting or issue-publishing concerns.
- The same evidence should support multiple outputs such as JSON reports, markdown summaries, and external issue adapters.

## Consequences

- Runtime must emit structured events consistently.
- Artifact capture and event persistence are foundational responsibilities.
- Reporting remains an application layer, not an execution concern.
