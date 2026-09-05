"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkbenchStateSchema, type WorkbenchState } from "@/lib/contracts";
import { createInitialState, exportAudit, previewImport, resolveConflict, resumeMigration, runIncrementalSync, startMigration } from "@/lib/engine";

const STORAGE_KEY = "reconcile-lab:v1";
const steps = [
  { phase: "READY", label: "Map & validate", detail: "Infer fields and isolate malformed input." },
  { phase: "PREVIEWED", label: "Stage import", detail: "Write paginated batches with injected faults." },
  { phase: "INTERRUPTED", label: "Resume safely", detail: "Replay from the last durable checkpoint." },
  { phase: "MIGRATED", label: "Sync deltas", detail: "Move JSON changes in both directions." },
  { phase: "CONFLICT", label: "Resolve conflict", detail: "Make the near-simultaneous edit explicit." },
] as const;
const phaseOrder = ["READY", "PREVIEWED", "INTERRUPTED", "MIGRATED", "CONFLICT", "RECONCILED"];

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function download(state: WorkbenchState) {
  const href = URL.createObjectURL(new Blob([exportAudit(state)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `reconcile-lab-${state.runId}.json`;
  link.click();
  URL.revokeObjectURL(href);
}

export default function Home() {
  const [state, setState] = useState<WorkbenchState>(() => createInitialState());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const restored = WorkbenchStateSchema.safeParse(JSON.parse(saved));
          if (restored.success) setState(restored.data);
          else window.localStorage.removeItem(STORAGE_KEY);
        } catch { window.localStorage.removeItem(STORAGE_KEY); }
      }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  const action = useMemo(() => {
    switch (state.phase) {
      case "READY": return { label: "Inspect mapping", run: () => setState(previewImport()) };
      case "PREVIEWED": return { label: "Start staged import", run: () => setState(startMigration(state)) };
      case "INTERRUPTED": return { label: "Replay failed page", run: () => setState(resumeMigration(state)) };
      case "MIGRATED": return { label: "Run bidirectional sync", run: () => setState(runIncrementalSync(state)) };
      case "CONFLICT": return { label: "Approve source version", run: () => setState(resolveConflict(state, "source")) };
      default: return state.syncCursors.cycle < 2
        ? { label: "Replay same deltas (no-op)", run: () => setState(runIncrementalSync(state)) }
        : { label: "Download audit artifact", run: () => download(state) };
    }
  }, [state]);

  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(createInitialState());
  };
  const currentStep = Math.min(phaseOrder.indexOf(state.phase), steps.length);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Reconcile Lab home"><span className="brandMark">R</span> Reconcile Lab <span className="version">v1.0</span></a>
        <nav><a href="#workbench">Workbench</a><a href="#evidence">Evidence</a><a href="https://github.com/kanwarvig/reconcile-lab" target="_blank" rel="noreferrer">Source ↗</a></nav>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span className="pulse" /> CONTROLLED SYSTEMS · DETERMINISTIC RUN</div>
        <h1>Make migration failures<br/><em>boringly recoverable.</em></h1>
        <p className="heroCopy">A migration and ongoing-sync workbench for customer accounts. Inspect the contract, trigger real failure branches, resume from durable cursors, and prove the destination is complete without duplicates.</p>
        <div className="heroActions"><button className="primary" disabled={!ready} onClick={action.run}>{action.label}<span>→</span></button><button className="secondary" disabled={!ready} onClick={() => download(state)}>Export current audit</button></div>
        <p className="disclosure">Runs entirely in this browser with persistent local state. Northstar CRM, LedgerDesk, timeouts, and rate limits are truthful simulations—not live vendor connections.</p>
      </section>

      <section className="systemStrip" aria-label="integration architecture">
        <div><span className="systemIcon source">N</span><p><strong>Northstar CRM</strong><small>Synthetic CSV + JSON source</small></p></div>
        <div className="connector"><span>paginated read</span><i>→</i><b>contract + receipts</b><i>↔</i><span>cursor feed</span></div>
        <div><span className="systemIcon dest">L</span><p><strong>LedgerDesk</strong><small>Controlled destination</small></p></div>
      </section>

      <section className="workbench" id="workbench">
        <div className="sectionHead"><div><span className="kicker">GUIDED RECOVERY PROOF</span><h2>One run. Five boundaries.</h2></div><div className={`status status-${state.phase.toLowerCase()}`}><span /> {state.phase.replace("_", " ")}</div></div>
        <div className="stepper">{steps.map((step, index) => <div className={`step ${index < currentStep ? "done" : ""} ${index === currentStep ? "active" : ""}`} key={step.phase}><div className="stepIndex">{index < currentStep ? "✓" : String(index + 1).padStart(2, "0")}</div><div><strong>{step.label}</strong><p>{step.detail}</p></div></div>)}</div>

        <div className="grid">
          <article className="panel mappingPanel">
            <div className="panelHead"><div><span className="kicker">BOUNDARY CONTRACT</span><h3>Schema mapping</h3></div><span className="tag">CSV · 12 ROWS</span></div>
            <p className="panelIntro">Aliases are inferred once, reviewed, then pinned to the run. The status field exposes the injected schema drift.</p>
            <div className="mappingTable">{Object.entries(state.mapping).map(([target, sources]) => <div className="mapRow" key={target}><code>{sources.join(" · ")}</code><span>→</span><b>{target}</b><small>{Math.round(state.mappingConfidence[target as keyof typeof state.mappingConfidence] * 100)}%</small></div>)}</div>
            <div className="callout amber"><b>Schema drift</b><span>account_status → account_state on row 8</span><small>Contained by reviewed alias mapping</small></div>
            {state.quarantine.length > 0 && <div className="callout red"><b>Quarantine</b><span>Row {state.quarantine[0].rowNumber}: invalid email</span><small>Excluded before destination write</small></div>}
          </article>

          <article className="panel runPanel">
            <div className="panelHead"><div><span className="kicker">DURABLE EXECUTION</span><h3>Import run</h3></div><span className="mono">{state.runId}</span></div>
            <div className="progressBlock"><div><span>Durable cursor</span><b>{state.checkpoint.cursor} / {state.source.length || 11}</b></div><progress max={state.source.length || 11} value={state.checkpoint.cursor} /><div className="progressMeta"><span>Page {state.checkpoint.page} of {state.checkpoint.totalPages || 4}</span><span>Batch size 3</span><span>{state.receipts.length} receipts</span></div></div>
            {state.failedJobs.map((job) => <div key={job.id} className={`failedJob ${job.status === "RECOVERED" ? "recovered" : ""}`}><span className="faultIcon">!</span><div><b>{job.status === "RECOVERED" ? "Recovered failure" : "Replayable failure"}</b><p>Timeout after {job.sourceId} destination write</p><small>{job.safeReplayReason}</small></div></div>)}
            {state.conflicts.map((conflict) => <div className="conflictCard" key={conflict.externalId}><span className="faultIcon">≠</span><div><b>{conflict.externalId} changed in both systems</b><p>Northstar proposes {conflict.source.name} / {conflict.source.email}; LedgerDesk proposes {conflict.destination.name} / {conflict.destination.email}.</p><small>Policy: manual review for concurrent cursor entries. No silent winner.</small></div></div>)}
            <button className="primary wide" disabled={!ready} onClick={action.run}>{action.label}<span>→</span></button>
            <p className="safeNote">No universal rollback claim: writes are staged and recoverable through idempotent replay; external irreversible effects are outside this simulation.</p>
          </article>
        </div>
      </section>

      <section className="evidence" id="evidence">
        <div className="sectionHead"><div><span className="kicker">MEASURED RESULT</span><h2>Reconciliation evidence</h2></div><button className="textButton" onClick={reset}>Reset deterministic run</button></div>
        <div className="metrics">
          <div><span>Missing</span><strong data-testid="missing-count">{state.metrics.missingRecords}</strong><small>unique valid source IDs</small></div>
          <div><span>Physical duplicates</span><strong data-testid="duplicate-count">{state.metrics.physicalDuplicates}</strong><small>destination rows</small></div>
          <div><span>Writes prevented</span><strong>{state.metrics.duplicateWritesPrevented}</strong><small>receipt matches</small></div>
          <div><span>Throughput proxy</span><strong>{state.metrics.recordsPerSecond}<sup>/s</sup></strong><small>derived from {state.metrics.simulatedDurationMs} ms</small></div>
          <div><span>Resource proxy</span><strong>{state.metrics.memoryProxyKb}<sup>KB</sup></strong><small>serialized input bytes</small></div>
          <div><span>Recovery steps</span><strong>{state.metrics.recoverySteps}</strong><small>checkpoint + decision</small></div>
        </div>
        <div className="reconcileLine"><span>Bidirectional set check</span><b>{state.metrics.destinationOnlyRecords} destination-only IDs</b><b>{state.metrics.divergentRecords} divergent shared IDs</b><b>source cursor {state.syncCursors.source.slice(11, 19)}Z</b><b>destination cursor {state.syncCursors.destination.slice(11, 19)}Z</b><b>cycle {state.syncCursors.cycle}</b></div>

        <div className="grid lower">
          <article className="panel tablePanel"><div className="panelHead"><div><span className="kicker">DESTINATION SAMPLE</span><h3>LedgerDesk accounts</h3></div><span className="tag">{state.destination.length} RECORDS</span></div><div className="records"><div className="record header"><span>ID</span><span>Account</span><span>Plan</span><span>Balance</span></div>{[...state.destination].sort((a, b) => a.externalId.localeCompare(b.externalId)).slice(0, 6).map((record) => <div className="record" key={record.externalId}><code>{record.externalId}</code><span><b>{record.name}</b><small>{record.email}</small></span><span className="plan">{record.plan}</span><span>{money(record.balanceCents)}</span></div>)}{state.destination.length === 0 && <p className="empty">No destination writes yet. Inspect the mapping to begin.</p>}</div></article>
          <article className="panel logPanel"><div className="panelHead"><div><span className="kicker">APPEND-ONLY TRACE</span><h3>Audit timeline</h3></div><span className="tag">{state.events.length} EVENTS</span></div><div className="timeline" aria-live="polite">{[...state.events].reverse().slice(0, 9).map((item) => <div className={`timelineItem ${item.kind.toLowerCase()}`} key={item.id}><i/><div><span>{item.kind}</span><time>{item.at.slice(11, 19)}Z</time><b>{item.title}</b><p>{item.detail}</p></div></div>)}</div></article>
        </div>
      </section>

      <footer><div className="brand"><span className="brandMark">R</span> Reconcile Lab</div><p>Built to make correctness visible, not merely claimed.</p><p>Controlled synthetic demonstration · No secrets · Local persistence</p></footer>
    </main>
  );
}
