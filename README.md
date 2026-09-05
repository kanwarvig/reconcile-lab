# Reconcile Lab

Reconcile Lab is a zero-secret, deterministic customer-account migration and ongoing-integration workbench. It makes failure recovery inspectable: raw CSV enters a typed contract, malformed rows are quarantined, pages are checkpointed, destination writes store idempotency receipts, and incremental JSON changes reconcile in both directions under an explicit conflict policy.

Northstar CRM and LedgerDesk are controlled browser-side simulations. Rate limits, timeouts, and schema drift are deliberate fault injections. This project does not claim a live vendor connection, production scale, or universal rollback after external side effects.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The guided sequence is:

1. Inspect mapping — parses the messy CSV, infers aliases, identifies schema drift, and quarantines malformed input.
2. Start staged import — paginates in batches of three, handles an injected 429 with backoff, then pauses after a destination write but before checkpoint acknowledgement.
3. Reload the browser if desired — job state, receipts, and cursor survive in `localStorage`.
4. Replay failed page — reloads the durable cursor; the destination receipt suppresses a second write.
5. Run bidirectional sync — applies one source-only and one destination-only delta, then holds a near-simultaneous conflict.
6. Approve source version — records the operator decision, converges both controlled systems, and reports missing/duplicate counts.

Use **Export current audit** to download the complete state, events, metrics, receipts, quarantine, and disclosures as JSON.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `PLAYWRIGHT_BASE_URL=https://<exact-alias>` to run the same browser flow against production. The E2E test clears browser state, interrupts the run, reloads and runtime-validates serialized state, resumes, syncs deltas, resolves a conflict, replays the same cursors as a no-op second cycle, and asserts zero missing and zero physical duplicate records.

## Configurable engine

`previewImport(csv, mappingOverride?)`, `startMigration(state, faultProfile)`, and `runIncrementalSync(state, changes)` accept caller-supplied inputs. The included CSV, JSON changes, and fault profile are reproducible defaults, not scripted result objects. Reconciliation and audit output are computed from the resulting state.

## Requirement-to-evidence matrix

| Requirement | Implementation evidence | Test / public interaction |
|---|---|---|
| Messy CSV ingest + mapping | `src/lib/fixtures.ts`, `inferMapping`, `normalizeRow` | **Inspect mapping**; schema-boundary tests |
| Boundary validation + quarantine | Zod `CustomerSchema`; `parseSource` | Row 9 appears in quarantine; malformed-input test |
| Schema drift | dual `account_status` / `account_state` aliases | Drift event and 86% mapping confidence |
| Pagination + rate limit | configurable fault profile; page size 3 | **Start staged import**; rate-limit test |
| Cursor/checkpoint restart | serializable `WorkbenchState`, browser persistence | JSON round-trip unit test and E2E browser reload |
| Timeout after destination write | configurable record position; receipt commits before timeout | interruption test confirms write with cursor still at 6 |
| Idempotency + duplicate prevention | `customer:<id>:v<version>` receipts | replay test: two prevented writes, zero physical duplicates |
| Ongoing two-way JSON sync | parsed `src/lib/deltas.json`; caller-supplied JSON string | **Run bidirectional sync**; syntax/record/sync tests |
| Independent sync cursors + replay | `syncCursors.source`, `.destination`, `.cycle` | **Replay same deltas (no-op)**; second-cycle unit/E2E proof |
| Conflict policy | manual review for concurrent change IDs | conflict card; resolution test |
| Reconciliation + metrics | actual source/destination set comparison | UI asserts missing 0 / physical duplicates 0 |
| Failed-job inspection + safe replay | `FailedJob` contract and recovery explanation | replayable/recovered failure card |
| Audit artifact | deterministic `exportAudit` | **Export current audit**; artifact test |

## Project map

- `src/lib/contracts.ts` — typed boundary and state contracts.
- `src/lib/engine.ts` — configurable mapping, import, recovery, sync, conflict, and reconciliation logic.
- `src/lib/fixtures.ts` and `src/lib/deltas.json` — raw inputs only; no scripted outputs.
- `src/app/page.tsx` — guided workbench and browser persistence.
- `tests/e2e/recovery.spec.ts` — browser → persistence → engine → UI restart proof.
- `docs/ARCHITECTURE.md`, `docs/ADR-001-browser-engine.md`, `docs/RUNBOOK.md` — design and operations evidence.

## Measured conditions and limits

The fixture has 12 input rows, one malformed row, one repeated source record, and 10 unique valid customer IDs. Throughput derives from actual simulated request attempts, configured backoff, and computed destination writes; resource use is serialized input size, not production CPU or heap telemetry. These make runs comparable but are not load-test results. A real connector would replace browser persistence and simulated endpoints with durable database/outbox storage, authenticated APIs, provider-specific cursor guarantees, and production observability.
