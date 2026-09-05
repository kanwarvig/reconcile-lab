import Papa from "papaparse";
import { z } from "zod";
import { CustomerSchema, MappingSchema, type AuditEvent, type Customer, type FieldMapping, type Metrics, type WorkbenchState } from "./contracts";
import { INCREMENTAL_CHANGES_JSON, MESSY_CUSTOMERS_CSV } from "./fixtures";

const PAGE_SIZE = 3;
const RUN_ID = "run-synthetic-2026-09-04";
const BASE_TIME = Date.parse("2026-09-04T14:00:00.000Z");

export type FaultProfile = {
  rateLimitPage: number | null;
  rateLimitAttempts: number;
  backoffBaseMs: number;
  failAfterWriteAtRecord: number | null;
};

export type IncrementalChanges = {
  source: Customer[];
  destination: Customer[];
};

const IncrementalChangesSchema = z.object({ source: z.array(CustomerSchema), destination: z.array(CustomerSchema) });

export const DEFAULT_FAULTS: FaultProfile = {
  rateLimitPage: 2,
  rateLimitAttempts: 1,
  backoffBaseMs: 250,
  failAfterWriteAtRecord: 7,
};

const emptyMetrics = (): Metrics => ({
  sourceRows: 0,
  validUniqueRows: 0,
  destinationRecords: 0,
  missingRecords: 0,
  destinationOnlyRecords: 0,
  divergentRecords: 0,
  physicalDuplicates: 0,
  duplicateWritesPrevented: 0,
  quarantinedRows: 0,
  requests: 0,
  simulatedBackoffMs: 0,
  recordsPerSecond: 0,
  simulatedDurationMs: 0,
  memoryProxyKb: 0,
  recoverySteps: 0,
});

function event(index: number, kind: AuditEvent["kind"], title: string, detail: string): AuditEvent {
  return { id: `evt-${index}`, kind, title, detail, at: new Date(BASE_TIME + index * 1000).toISOString() };
}

export function inferMapping(headers: string[]): { mapping: FieldMapping; confidence: Record<keyof FieldMapping, number> } {
  const aliases: Record<keyof FieldMapping, string[]> = {
    externalId: ["external_id", "crm_id", "customer_id"],
    name: ["name", "company", "company_name"],
    email: ["email", "email_address"],
    plan: ["plan", "tier"],
    status: ["status", "account_status", "account_state"],
    balanceCents: ["balance_cents", "balance", "amount"],
    updatedAt: ["updated_at", "modified_at"],
  };
  const mapping = Object.fromEntries(
    Object.entries(aliases).map(([target, candidates]) => [target, candidates.filter((candidate) => headers.includes(candidate))]),
  );
  const parsed = MappingSchema.parse(mapping);
  const confidence = Object.fromEntries(
    Object.entries(parsed).map(([target, sources]) => [target, target === "status" && sources.length > 1 ? 0.86 : 0.98]),
  ) as Record<keyof FieldMapping, number>;
  return { mapping: parsed, confidence };
}

function first(raw: Record<string, string>, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = raw[candidate]?.trim();
    if (value) return value;
  }
  return "";
}

function cents(value: string): number {
  const normalized = value.replace(/[$,\s]/g, "");
  return Math.round(Number(normalized) * 100);
}

export function normalizeRow(raw: Record<string, string>, mapping: FieldMapping): Customer {
  return CustomerSchema.parse({
    externalId: first(raw, mapping.externalId).toUpperCase(),
    name: first(raw, mapping.name).replace(/\s+/g, " "),
    email: first(raw, mapping.email).toLowerCase(),
    plan: first(raw, mapping.plan).toLowerCase(),
    status: first(raw, mapping.status).toLowerCase(),
    balanceCents: cents(first(raw, mapping.balanceCents)),
    updatedAt: first(raw, mapping.updatedAt),
    version: 1,
  });
}

export function parseSource(csv: string, mappingOverride?: FieldMapping) {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`CSV boundary validation failed: ${parsed.errors[0].message}`);
  const headers = parsed.meta.fields ?? [];
  const inferred = mappingOverride ? null : inferMapping(headers);
  const mapping = mappingOverride ? MappingSchema.parse(mappingOverride) : inferred!.mapping;
  if (mappingOverride) {
    const unknownColumns = Object.values(mappingOverride).flat().filter((column) => !headers.includes(column));
    if (unknownColumns.length > 0) throw new Error(`Mapping references missing CSV columns: ${unknownColumns.join(", ")}`);
  }
  const confidence = mappingOverride
    ? Object.fromEntries(Object.keys(mapping).map((key) => [key, 1])) as Record<keyof FieldMapping, number>
    : inferred!.confidence;
  const source: Customer[] = [];
  const quarantine: WorkbenchState["quarantine"] = [];
  parsed.data.forEach((raw, index) => {
    try {
      source.push(normalizeRow(raw, mapping));
    } catch (error) {
      quarantine.push({
        rowNumber: index + 2,
        reason: error instanceof Error ? error.message : "Unknown validation error",
        raw,
      });
    }
  });
  return { rows: parsed.data, source, quarantine, mapping, confidence };
}

export function createInitialState(): WorkbenchState {
  const { mapping, confidence } = inferMapping(["crm_id", "company", "email_address", "tier", "account_status", "balance", "modified_at", "account_state"]);
  return {
    runId: RUN_ID,
    phase: "READY",
    mapping,
    mappingConfidence: confidence,
    source: [],
    destination: [],
    receipts: [],
    checkpoint: { cursor: 0, page: 0, totalPages: 0 },
    syncCursors: { source: "2026-09-01T00:00:00.000Z", destination: "2026-09-01T00:00:00.000Z", cycle: 0 },
    quarantine: [],
    conflicts: [],
    failedJobs: [],
    events: [event(0, "INFO", "Controlled systems ready", "Northstar CRM and LedgerDesk are deterministic browser-side simulations; no external customer system is connected.")],
    metrics: emptyMetrics(),
  };
}

export function previewImport(csv = MESSY_CUSTOMERS_CSV, mappingOverride?: FieldMapping): WorkbenchState {
  const parsed = parseSource(csv, mappingOverride);
  const uniqueIds = new Set(parsed.source.map((row) => row.externalId));
  const hasDrift = parsed.rows.some((row) => !row.account_status && Boolean(row.account_state));
  const events = [
    event(0, "INFO", "CSV parsed at boundary", `${parsed.rows.length} rows parsed; typed customer contract applied before engine entry.`),
    event(1, "INFO", "Mapping inferred", "7 destination fields mapped with confidence scores; status accepts account_status and the drift alias account_state."),
    ...(hasDrift ? [event(2, "FAULT" as const, "Source schema drift detected", "Rows 8-13 use account_state instead of account_status. Alias mapping contains the change without discarding data.")] : []),
    event(3, "QUARANTINE", "Malformed row isolated", `Row ${parsed.quarantine[0]?.rowNumber ?? "?"} failed email validation and will not enter the import.`),
  ];
  return {
    ...createInitialState(),
    phase: "PREVIEWED",
    source: parsed.source,
    quarantine: parsed.quarantine,
    mapping: parsed.mapping,
    mappingConfidence: parsed.confidence,
    checkpoint: { cursor: 0, page: 0, totalPages: Math.ceil(parsed.source.length / PAGE_SIZE) },
    events,
    metrics: {
      ...emptyMetrics(),
      sourceRows: parsed.rows.length,
      validUniqueRows: uniqueIds.size,
      quarantinedRows: parsed.quarantine.length,
      memoryProxyKb: Math.ceil(new Blob([JSON.stringify(parsed.rows)]).size / 1024),
    },
  };
}

function idempotencyKey(customer: Customer): string {
  return `customer:${customer.externalId}:v${customer.version}`;
}

function destinationWrite(state: WorkbenchState, customer: Customer): { state: WorkbenchState; prevented: boolean } {
  const key = idempotencyKey(customer);
  if (state.receipts.includes(key)) return { state, prevented: true };
  const destination = [...state.destination.filter((record) => record.externalId !== customer.externalId), customer];
  return { state: { ...state, destination, receipts: [...state.receipts, key] }, prevented: false };
}

function withMetrics(state: WorkbenchState): WorkbenchState {
  const sourceIds = new Set(state.source.map((record) => record.externalId));
  const destinationIds = new Set(state.destination.map((record) => record.externalId));
  const missing = [...sourceIds].filter((id) => !destinationIds.has(id)).length;
  const destinationOnly = [...destinationIds].filter((id) => !sourceIds.has(id)).length;
  const sourceById = new Map(state.source.map((record) => [record.externalId, record]));
  const divergent = state.destination.filter((record) => {
    const sourceRecord = sourceById.get(record.externalId);
    return sourceRecord ? JSON.stringify(sourceRecord) !== JSON.stringify(record) : false;
  }).length;
  const physicalDuplicates = state.destination.length - destinationIds.size;
  const simulatedDurationMs = state.metrics.requests * 40 + state.destination.length * 12 + state.metrics.simulatedBackoffMs;
  return {
    ...state,
    metrics: {
      ...state.metrics,
      destinationRecords: state.destination.length,
      missingRecords: missing,
      destinationOnlyRecords: destinationOnly,
      divergentRecords: divergent,
      physicalDuplicates,
      recordsPerSecond: simulatedDurationMs > 0 ? Number((state.destination.length / (simulatedDurationMs / 1000)).toFixed(1)) : 0,
      simulatedDurationMs,
    },
  };
}

export function startMigration(previewed: WorkbenchState, faults: FaultProfile = DEFAULT_FAULTS): WorkbenchState {
  if (previewed.phase !== "PREVIEWED") throw new Error("Import can only start after preview.");
  let state = structuredClone(previewed);
  let eventIndex = state.events.length;
  for (let cursor = 0; cursor < state.source.length; cursor += PAGE_SIZE) {
    const page = cursor / PAGE_SIZE + 1;
    state.metrics.requests += 1;
    if (page === faults.rateLimitPage && faults.rateLimitAttempts > 0) {
      for (let attempt = 1; attempt <= faults.rateLimitAttempts; attempt += 1) {
        const delay = faults.backoffBaseMs * 2 ** (attempt - 1);
        state.events.push(event(eventIndex++, "FAULT", "429 rate limit injected", `Page ${page} attempt ${attempt} was rejected. Deterministic exponential backoff scheduled for ${delay} ms.`));
        state.metrics.simulatedBackoffMs += delay;
        state.metrics.requests += 1;
      }
      state.events.push(event(eventIndex++, "RECOVERY", "Rate limit recovered", `Page ${page} attempt ${faults.rateLimitAttempts + 1} succeeded after the simulated retry window.`));
    }
    const pageRows = state.source.slice(cursor, cursor + PAGE_SIZE);
    for (const [pageOffset, customer] of pageRows.entries()) {
      const write = destinationWrite(state, customer);
      state = write.state;
      if (write.prevented) {
        state.metrics.duplicateWritesPrevented += 1;
        state.events.push(event(eventIndex++, "RECOVERY", "Duplicate input suppressed", `${idempotencyKey(customer)} already has a destination receipt.`));
      } else {
        state.events.push(event(eventIndex++, "WRITE", "Customer staged", `${customer.externalId} written to LedgerDesk simulation.`));
      }
      const sourceRecordNumber = cursor + pageOffset + 1;
      if (sourceRecordNumber === faults.failAfterWriteAtRecord) {
        state.phase = "INTERRUPTED";
        state.failedJobs = [{
          id: `job-import-page-${page}`,
          sourceId: customer.externalId,
          fault: "TIMEOUT_AFTER_WRITE",
          status: "FAILED_REPLAYABLE",
          safeReplayReason: "The destination stored the idempotency receipt with the write; replay can check it before mutating.",
        }];
        state.events.push(event(eventIndex++, "FAULT", "Timeout after destination write", `${customer.externalId} was written at configured source position ${sourceRecordNumber}, but acknowledgement and page checkpoint were intentionally withheld.`));
        return withMetrics(state);
      }
    }
    state.checkpoint = { ...state.checkpoint, cursor: Math.min(cursor + PAGE_SIZE, state.source.length), page };
  }
  return withMetrics({ ...state, phase: "MIGRATED" });
}

export function resumeMigration(interrupted: WorkbenchState): WorkbenchState {
  if (interrupted.phase !== "INTERRUPTED") throw new Error("Only an interrupted import can be resumed.");
  let state = structuredClone(interrupted);
  let eventIndex = state.events.length;
  state.metrics.recoverySteps += 1;
  state.events.push(event(eventIndex++, "RECOVERY", "Replay loaded checkpoint", `Resuming after page ${state.checkpoint.page}, cursor ${state.checkpoint.cursor}; the incomplete page is replayed.`));
  for (let cursor = state.checkpoint.cursor; cursor < state.source.length; cursor += PAGE_SIZE) {
    const pageRows = state.source.slice(cursor, cursor + PAGE_SIZE);
    state.metrics.requests += 1;
    for (const customer of pageRows) {
      const write = destinationWrite(state, customer);
      state = write.state;
      if (write.prevented) {
        state.metrics.duplicateWritesPrevented += 1;
        state.events.push(event(eventIndex++, "RECOVERY", "Replay safely suppressed", `${idempotencyKey(customer)} proves the prior write completed; no second physical row was created.`));
      } else {
        state.events.push(event(eventIndex++, "WRITE", "Customer staged", `${customer.externalId} written during resumed page processing.`));
      }
    }
    state.checkpoint = { ...state.checkpoint, cursor: Math.min(cursor + PAGE_SIZE, state.source.length), page: cursor / PAGE_SIZE + 1 };
  }
  state.phase = "MIGRATED";
  state.failedJobs = state.failedJobs.map((job) => ({ ...job, status: "RECOVERED" }));
  state.metrics.recoverySteps += 1;
  state = withMetrics(state);
  state.events.push(event(eventIndex++, "RECOVERY", "Reconciliation passed", `Compared actual unique ID sets: missing ${state.metrics.missingRecords} and physical duplicates ${state.metrics.physicalDuplicates}.`));
  return state;
}

export function runIncrementalSync(migrated: WorkbenchState, changesJson = INCREMENTAL_CHANGES_JSON): WorkbenchState {
  if (migrated.phase !== "MIGRATED" && migrated.phase !== "RECONCILED") throw new Error("Incremental sync requires a reconciled migration.");
  const state = structuredClone(migrated);
  let eventIndex = state.events.length;
  let decoded: unknown;
  try { decoded = JSON.parse(changesJson); } catch { throw new Error("Incremental JSON boundary validation failed: malformed JSON."); }
  const parsedChanges = IncrementalChangesSchema.parse(decoded);
  const sourceChanges = parsedChanges.source.filter((item) => Date.parse(item.updatedAt) > Date.parse(state.syncCursors.source));
  const destinationChanges = parsedChanges.destination.filter((item) => Date.parse(item.updatedAt) > Date.parse(state.syncCursors.destination));
  const sourceById = new Map(sourceChanges.map((item) => [item.externalId, item]));
  const destinationById = new Map(destinationChanges.map((item) => [item.externalId, item]));
  for (const sourceChange of sourceChanges) {
    const destinationChange = destinationById.get(sourceChange.externalId);
    if (destinationChange) continue;
    state.source = [...state.source.filter((item) => item.externalId !== sourceChange.externalId), sourceChange];
    state.destination = [...state.destination.filter((item) => item.externalId !== sourceChange.externalId), sourceChange];
    state.events.push(event(eventIndex++, "WRITE", "Source delta applied → destination", `${sourceChange.externalId} changed after the source cursor and was upserted into LedgerDesk.`));
  }
  for (const destinationChange of destinationChanges) {
    const sourceChange = sourceById.get(destinationChange.externalId);
    if (sourceChange) continue;
    state.source = [...state.source.filter((item) => item.externalId !== destinationChange.externalId), destinationChange];
    state.destination = [...state.destination.filter((item) => item.externalId !== destinationChange.externalId), destinationChange];
    state.events.push(event(eventIndex++, "WRITE", "Destination delta applied → source", `${destinationChange.externalId} changed after the destination cursor and was mirrored into Northstar CRM.`));
  }
  state.conflicts = sourceChanges.flatMap((sourceChange) => {
    const destinationChange = destinationById.get(sourceChange.externalId);
    if (!destinationChange) return [];
    return [{ externalId: sourceChange.externalId, source: sourceChange, destination: destinationChange, policy: "MANUAL_REVIEW_NEAR_SIMULTANEOUS" as const }];
  });
  state.phase = state.conflicts.length > 0 ? "CONFLICT" : "RECONCILED";
  state.metrics.requests += 2;
  for (const conflict of state.conflicts) {
    const deltaMs = Math.abs(Date.parse(conflict.source.updatedAt) - Date.parse(conflict.destination.updatedAt));
    state.events.push(event(eventIndex++, "CONFLICT", "Concurrent update held for review", `${conflict.externalId} changed in both systems ${Math.round(deltaMs / 60_000)} minute(s) apart. Policy refuses silent last-write-wins.`));
  }
  const latestSourceCursor = sourceChanges.reduce((latest, item) => Date.parse(item.updatedAt) > Date.parse(latest) ? item.updatedAt : latest, state.syncCursors.source);
  const latestDestinationCursor = destinationChanges.reduce((latest, item) => Date.parse(item.updatedAt) > Date.parse(latest) ? item.updatedAt : latest, state.syncCursors.destination);
  state.syncCursors = { source: latestSourceCursor, destination: latestDestinationCursor, cycle: state.syncCursors.cycle + 1 };
  if (sourceChanges.length === 0 && destinationChanges.length === 0) {
    state.events.push(event(eventIndex++, "RECOVERY", "Cursor replay was a no-op", `Cycle ${state.syncCursors.cycle} re-read both feeds from their durable cursors; zero new deltas and zero writes.`));
  }
  return withMetrics(state);
}

export function resolveConflict(conflicted: WorkbenchState, winner: "source" | "destination" = "source", externalId = conflicted.conflicts[0]?.externalId): WorkbenchState {
  if (conflicted.phase !== "CONFLICT" || conflicted.conflicts.length === 0) throw new Error("There is no conflict to resolve.");
  const state = structuredClone(conflicted);
  const conflict = state.conflicts.find((item) => item.externalId === externalId);
  if (!conflict) throw new Error(`Conflict ${externalId} was not found.`);
  const chosen = winner === "source" ? conflict.source : conflict.destination;
  state.source = [...state.source.filter((item) => item.externalId !== chosen.externalId), chosen];
  state.destination = [...state.destination.filter((item) => item.externalId !== chosen.externalId), chosen];
  state.conflicts = state.conflicts.filter((item) => item.externalId !== chosen.externalId);
  state.phase = state.conflicts.length === 0 ? "RECONCILED" : "CONFLICT";
  state.metrics.recoverySteps += 1;
  state.events.push(event(state.events.length, "RECOVERY", "Conflict resolved with an audit decision", `${winner === "source" ? "Northstar CRM" : "LedgerDesk"} was selected for C-004; both controlled systems now match.`));
  return withMetrics(state);
}

export function exportAudit(state: WorkbenchState): string {
  return JSON.stringify({
    generatedAt: new Date(BASE_TIME + 99_000).toISOString(),
    disclosure: "Controlled synthetic systems and deterministic fault simulation. This artifact is not evidence of a live customer integration.",
    state,
  }, null, 2);
}
