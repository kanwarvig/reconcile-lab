# Architecture

## User story

An operator previews imperfect customer-account data, accepts a typed mapping, runs a paginated import, inspects an injected partial failure, resumes after a browser restart, applies ongoing changes in both directions, resolves a concurrent edit, and downloads evidence that the controlled systems converged without missing or duplicate rows.

## Boundaries

```text
Messy CSV ──parse──> unknown row maps ──Zod + mapping──> Customer[]
                                                           │
Northstar mirror <──JSON cursors── Workbench engine ──idempotent upsert──> LedgerDesk mirror
                                  │        │
                                  │        └── receipt set + page cursor
                                  └── audit, quarantine, failures, metrics
                                                   │
                                                   ▼
                                      serialized browser localStorage
```

Raw CSV and external-style JSON are untrusted at entry. The engine receives only `Customer` values accepted by `CustomerSchema`. Each destination mutation uses `customer:<externalId>:v<version>` as its idempotency key. The receipt and synthetic destination write occur together inside one state transition; the injected timeout happens afterward, so replay distinguishes a completed write from an unattempted one.

The page cursor advances only after every accepted record in a page is acknowledged. A timeout therefore retains the last complete page cursor while keeping the receipt for the post-checkpoint write. Serializing the whole state makes recovery testable across a fresh JavaScript engine after reload.

## Incremental sync

The source and destination accept independent synthetic cursor feeds. Source-only IDs move to LedgerDesk; destination-only IDs move back to Northstar. IDs present in both feeds are held under `MANUAL_REVIEW_NEAR_SIMULTANEOUS`. The operator chooses a winner; the decision is appended to the audit trail and both mirrors converge.

## Observability and production evolution

Events and metrics are computed from state: valid unique source IDs, destination IDs, missing count, physical duplicate count, receipt suppressions, attempts, backoff, throughput proxy, serialized-input resource proxy, and recovery steps.

For live connectors, move state into transactional durable storage. Keep receipts in a unique-key table, checkpoint only after all page effects commit, use an outbox for outbound mutations, encrypt tokens, validate responses, and add lease fencing. Provider semantics determine whether rollback, compensation, or forward repair is safe; this lab promises only staged replay within its controlled boundary.

