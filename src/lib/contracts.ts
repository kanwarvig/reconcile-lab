import { z } from "zod";

export const CustomerSchema = z.object({
  externalId: z.string().regex(/^C-\d{3}$/),
  name: z.string().min(2),
  email: z.string().email(),
  plan: z.enum(["starter", "growth", "scale"]),
  status: z.enum(["active", "paused"]),
  balanceCents: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
});

export type Customer = z.infer<typeof CustomerSchema>;

export const MappingSchema = z.object({
  externalId: z.array(z.string()).min(1),
  name: z.array(z.string()).min(1),
  email: z.array(z.string()).min(1),
  plan: z.array(z.string()).min(1),
  status: z.array(z.string()).min(1),
  balanceCents: z.array(z.string()).min(1),
  updatedAt: z.array(z.string()).min(1),
});

export type FieldMapping = z.infer<typeof MappingSchema>;

export type RunPhase =
  | "READY"
  | "PREVIEWED"
  | "INTERRUPTED"
  | "MIGRATED"
  | "CONFLICT"
  | "RECONCILED";

export type AuditEvent = {
  id: string;
  kind: "INFO" | "WRITE" | "FAULT" | "RECOVERY" | "QUARANTINE" | "CONFLICT";
  title: string;
  detail: string;
  at: string;
};

export type QuarantinedRow = {
  rowNumber: number;
  reason: string;
  raw: Record<string, string>;
};

export type Conflict = {
  externalId: string;
  source: Customer;
  destination: Customer;
  policy: "MANUAL_REVIEW_NEAR_SIMULTANEOUS";
};

export type FailedJob = {
  id: string;
  sourceId: string;
  fault: "TIMEOUT_AFTER_WRITE";
  status: "FAILED_REPLAYABLE" | "RECOVERED";
  safeReplayReason: string;
};

export type Metrics = {
  sourceRows: number;
  validUniqueRows: number;
  destinationRecords: number;
  missingRecords: number;
  destinationOnlyRecords: number;
  divergentRecords: number;
  physicalDuplicates: number;
  duplicateWritesPrevented: number;
  quarantinedRows: number;
  requests: number;
  simulatedBackoffMs: number;
  recordsPerSecond: number;
  simulatedDurationMs: number;
  memoryProxyKb: number;
  recoverySteps: number;
};

export type WorkbenchState = {
  runId: string;
  phase: RunPhase;
  mapping: FieldMapping;
  mappingConfidence: Record<keyof FieldMapping, number>;
  source: Customer[];
  destination: Customer[];
  receipts: string[];
  checkpoint: { cursor: number; page: number; totalPages: number };
  syncCursors: { source: string; destination: string; cycle: number };
  quarantine: QuarantinedRow[];
  conflicts: Conflict[];
  failedJobs: FailedJob[];
  events: AuditEvent[];
  metrics: Metrics;
};

const AuditEventSchema = z.object({ id: z.string(), kind: z.enum(["INFO", "WRITE", "FAULT", "RECOVERY", "QUARANTINE", "CONFLICT"]), title: z.string(), detail: z.string(), at: z.string().datetime() });
const MetricsSchema = z.object({
  sourceRows: z.number(), validUniqueRows: z.number(), destinationRecords: z.number(), missingRecords: z.number(), destinationOnlyRecords: z.number(), divergentRecords: z.number(), physicalDuplicates: z.number(), duplicateWritesPrevented: z.number(), quarantinedRows: z.number(), requests: z.number(), simulatedBackoffMs: z.number(), recordsPerSecond: z.number(), simulatedDurationMs: z.number(), memoryProxyKb: z.number(), recoverySteps: z.number(),
});

export const WorkbenchStateSchema = z.object({
  runId: z.string(),
  phase: z.enum(["READY", "PREVIEWED", "INTERRUPTED", "MIGRATED", "CONFLICT", "RECONCILED"]),
  mapping: MappingSchema,
  mappingConfidence: z.record(z.string(), z.number()),
  source: z.array(CustomerSchema),
  destination: z.array(CustomerSchema),
  receipts: z.array(z.string()),
  checkpoint: z.object({ cursor: z.number().int().nonnegative(), page: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }),
  syncCursors: z.object({ source: z.string().datetime(), destination: z.string().datetime(), cycle: z.number().int().nonnegative() }),
  quarantine: z.array(z.object({ rowNumber: z.number().int().positive(), reason: z.string(), raw: z.record(z.string(), z.string()) })),
  conflicts: z.array(z.object({ externalId: z.string(), source: CustomerSchema, destination: CustomerSchema, policy: z.literal("MANUAL_REVIEW_NEAR_SIMULTANEOUS") })),
  failedJobs: z.array(z.object({ id: z.string(), sourceId: z.string(), fault: z.literal("TIMEOUT_AFTER_WRITE"), status: z.enum(["FAILED_REPLAYABLE", "RECOVERED"]), safeReplayReason: z.string() })),
  events: z.array(AuditEventSchema),
  metrics: MetricsSchema,
});

export const AuditArtifactSchema = z.object({
  generatedAt: z.string().datetime(),
  disclosure: z.string(),
  state: WorkbenchStateSchema,
});
