import { describe, expect, it } from "vitest";
import { WorkbenchStateSchema } from "./contracts";
import { createInitialState, exportAudit, inferMapping, parseSource, previewImport, resolveConflict, resumeMigration, runIncrementalSync, startMigration } from "./engine";

describe("schema boundary", () => {
  it("infers the drift alias and quarantines malformed input", () => {
    const state = previewImport();
    expect(state.mapping.status).toEqual(["account_status", "account_state"]);
    expect(state.quarantine).toHaveLength(1);
    expect(state.quarantine[0].rowNumber).toBe(9);
    expect(state.metrics.sourceRows).toBe(12);
    expect(state.metrics.validUniqueRows).toBe(10);
    expect(state.events.some((item) => item.title === "Source schema drift detected")).toBe(true);
  });

  it("rejects a mapping when a required destination field is absent", () => {
    expect(() => inferMapping(["crm_id", "company"])).toThrow();
  });

  it("rejects mapping overrides that name absent input columns", () => {
    const mapping = previewImport().mapping;
    expect(() => parseSource("crm_id,company\nC-001,Acme", { ...mapping, email: ["not_a_column"] })).toThrow(/missing CSV columns/);
  });
});

describe("durable migration", () => {
  it("persists the write but not the cursor when timeout is injected", () => {
    const interrupted = startMigration(previewImport());
    expect(interrupted.phase).toBe("INTERRUPTED");
    expect(interrupted.destination.some((row) => row.externalId === "C-006")).toBe(true);
    expect(interrupted.checkpoint.cursor).toBe(6);
    expect(interrupted.failedJobs[0].status).toBe("FAILED_REPLAYABLE");
  });

  it("resumes a serialized checkpoint without duplicate physical rows", () => {
    const interrupted = startMigration(previewImport());
    const restartedEngineState = JSON.parse(JSON.stringify(interrupted));
    expect(WorkbenchStateSchema.safeParse(restartedEngineState).success).toBe(true);
    const recovered = resumeMigration(restartedEngineState);
    expect(recovered.phase).toBe("MIGRATED");
    expect(recovered.metrics.missingRecords).toBe(0);
    expect(recovered.metrics.physicalDuplicates).toBe(0);
    expect(recovered.metrics.duplicateWritesPrevented).toBe(2);
    expect(new Set(recovered.destination.map((row) => row.externalId)).size).toBe(10);
    expect(recovered.failedJobs[0].status).toBe("RECOVERED");
  });

  it("accounts for rate-limit backoff and request attempts", () => {
    const interrupted = startMigration(previewImport());
    expect(interrupted.metrics.simulatedBackoffMs).toBe(250);
    expect(interrupted.events.some((item) => item.title === "429 rate limit injected")).toBe(true);
    expect(interrupted.events.some((item) => item.title === "Rate limit recovered")).toBe(true);
  });

  it("drives fault locations from a caller-supplied profile", () => {
    const interrupted = startMigration(previewImport(), {
      rateLimitPage: null,
      rateLimitAttempts: 0,
      backoffBaseMs: 100,
      failAfterWriteAtRecord: 1,
    });
    expect(interrupted.failedJobs[0].sourceId).toBe("C-001");
    expect(interrupted.checkpoint.cursor).toBe(0);
    expect(interrupted.metrics.simulatedBackoffMs).toBe(0);
  });
});

describe("ongoing reconciliation", () => {
  it("syncs one-way changes but holds concurrent edits for explicit resolution", () => {
    const migrated = resumeMigration(startMigration(previewImport()));
    const conflicted = runIncrementalSync(migrated);
    expect(conflicted.phase).toBe("CONFLICT");
    expect(conflicted.conflicts).toHaveLength(1);
    expect(conflicted.destination.find((row) => row.externalId === "C-002")?.email).toBe("billing@beacon.test");
    expect(conflicted.source.find((row) => row.externalId === "C-003")?.status).toBe("paused");
  });

  it("applies the audited winner consistently to both controlled systems", () => {
    const conflicted = runIncrementalSync(resumeMigration(startMigration(previewImport())));
    const final = resolveConflict(conflicted, "source");
    expect(final.phase).toBe("RECONCILED");
    expect(final.conflicts).toHaveLength(0);
    expect(final.destination.find((row) => row.externalId === "C-004")?.name).toBe("Delta Freight Group");
    expect(final.metrics.missingRecords).toBe(0);
    expect(final.metrics.physicalDuplicates).toBe(0);
  });

  it("computes incremental work from caller-supplied change sets", () => {
    const migrated = resumeMigration(startMigration(previewImport()));
    const baseline = migrated.source.find((row) => row.externalId === "C-001")!;
    const synced = runIncrementalSync(migrated, JSON.stringify({
      source: [{ ...baseline, name: "Acme Solar Canada", version: 2, updatedAt: "2026-09-03T10:00:00.000Z" }],
      destination: [],
    }));
    expect(synced.phase).toBe("RECONCILED");
    expect(synced.destination.find((row) => row.externalId === "C-001")?.name).toBe("Acme Solar Canada");
    expect(synced.conflicts).toHaveLength(0);
  });

  it("advances independent cursors and makes replayed deltas a no-op", () => {
    const firstCycle = runIncrementalSync(resumeMigration(startMigration(previewImport())));
    const resolved = resolveConflict(firstCycle, "source");
    const destinationBeforeReplay = JSON.stringify(resolved.destination);
    const receiptsBeforeReplay = [...resolved.receipts];
    const secondCycle = runIncrementalSync(JSON.parse(JSON.stringify(resolved)));
    expect(firstCycle.syncCursors.source).toBe("2026-09-02T11:04:00.000Z");
    expect(firstCycle.syncCursors.destination).toBe("2026-09-02T11:05:00.000Z");
    expect(secondCycle.syncCursors.cycle).toBe(2);
    expect(JSON.stringify(secondCycle.destination)).toBe(destinationBeforeReplay);
    expect(secondCycle.receipts).toEqual(receiptsBeforeReplay);
    expect(secondCycle.events.at(-1)?.title).toBe("Cursor replay was a no-op");
  });

  it("validates JSON feed syntax and customer records at the boundary", () => {
    const migrated = resumeMigration(startMigration(previewImport()));
    expect(() => runIncrementalSync(migrated, "{" )).toThrow(/malformed JSON/);
    expect(() => runIncrementalSync(migrated, JSON.stringify({ source: [{ externalId: "bad" }], destination: [] }))).toThrow();
  });
});

describe("audit artifact", () => {
  it("exports a deterministic, truthfully labelled result", () => {
    const artifact = JSON.parse(exportAudit(createInitialState()));
    expect(artifact.generatedAt).toBe("2026-09-04T14:01:39.000Z");
    expect(artifact.disclosure).toContain("Controlled synthetic systems");
  });
});
