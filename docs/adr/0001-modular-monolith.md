# ADR 0001: Modular Monolith Baseline

## Status

Accepted

## Decision

The platform is implemented as a modular monolith inside one repository and one workspace.

## Rationale

- Early platform risk is dominated by debuggability, not network isolation.
- Tester and Player must share a strong runtime foundation without service-boundary duplication.
- Package boundaries inside one process are easier to evolve safely than premature microservices.

## Consequences

- Internal package boundaries must remain strict.
- Infrastructure adapters are replaceable without service extraction.
- If future scale requires process separation, it should happen after contracts and evidence flow stabilize.
