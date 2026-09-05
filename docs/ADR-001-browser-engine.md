# ADR-001: Use a persistent deterministic browser engine

- Status: accepted
- Date: 2026-09-04

## Context

The proof needs real recovery logic, reproducible faults, and a public zero-secret deployment. Connecting a vendor sandbox first would make it dependent on credentials, quotas, unstable test data, and provider-specific semantics.

## Decision

Implement both systems as controlled typed state machines in the browser. Persist complete job state in `localStorage`; keep raw CSV/JSON fixtures versioned; inject faults through a configurable profile; compute results through the same functions exercised by Vitest and Playwright.

## Consequences

The complete recovery path runs on any public Vercel alias without secrets. Tests prove restart recovery rather than retry-only behavior. This is not evidence of network durability, multi-worker concurrency, vendor authentication, or production scale. The contracts and transitions can later move behind API routes and transactional storage.

## Rejected alternatives

- Hard-coded successful output: cannot demonstrate recovery logic.
- Live sandbox first: weakens reproducibility and zero-secret public access.
- “Rollback everything”: arbitrary external effects may be irreversible; this lab demonstrates checkpointed forward recovery and audited conflict resolution.

