# Demo and recovery runbook

## Happy recovery path

1. Reset the deterministic run.
2. Inspect mapping. Confirm 12 input rows, the status alias change, and row 9 quarantine.
3. Start staged import. Confirm the 429 retry and a stop after the configured destination write.
4. Reload. Confirm phase remains `INTERRUPTED`, cursor remains 6, and the failed job is replayable.
5. Replay. Confirm the stored receipt suppresses the repeated mutation and reconciliation reports missing 0 / physical duplicates 0.
6. Run bidirectional sync. Confirm source-only and destination-only updates move, while the shared ID is held.
7. Approve the source version. Confirm both mirrors converge and phase becomes `RECONCILED`.
8. Replay the same deltas. Confirm both independent cursors produce zero new changes/writes and cycle becomes 2.
9. Export the audit artifact with its test conditions.

## Fault interpretation

| Fault | Expected symptom | Safe recovery |
|---|---|---|
| Schema drift | old status field empties while its alias appears | Review alias and pin mapping before writes |
| Malformed row | customer contract rejects the row | Inspect quarantine; correct source in a new run |
| 429 rate limit | configured page attempts fail | Exponential backoff and same-page retry |
| Timeout after write | receipt exists but page cursor does not advance | Reload cursor; receipt suppresses mutation |
| Conflicting updates | ID appears in both cursor feeds | Hold both, choose a winner, append decision |

Do not interpret a successful lab run as proof that a third-party API supports atomic writes, rollback, or these cursor semantics. Before adapting a connector, document provider pagination stability, idempotency, rate-limit headers, update ordering, tombstones, and compensation rules. Test network loss at every boundary against a sandbox before customer data.
