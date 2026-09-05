"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AuditEvent, Customer, FieldMapping } from "@/lib/contracts";
import { useWorkbench } from "./app-shell";

const stages = [
  { id: "map", label: "Map", detail: "Match source fields", phases: ["READY", "PREVIEWED"] },
  { id: "validate", label: "Validate", detail: "Quarantine invalid rows", phases: ["PREVIEWED"] },
  { id: "import", label: "Import", detail: "Write paginated batches", phases: ["INTERRUPTED"] },
  { id: "resume", label: "Resume", detail: "Replay from checkpoint", phases: ["INTERRUPTED"] },
  { id: "sync", label: "Sync", detail: "Advance both cursors", phases: ["MIGRATED"] },
  { id: "reconcile", label: "Reconcile", detail: "Resolve shared changes", phases: ["CONFLICT", "RECONCILED"] },
  { id: "audit", label: "Audit", detail: "Export proof artifact", phases: ["RECONCILED"] },
] as const;

type InspectorSelection =
  | { kind: "mapping"; key: keyof FieldMapping }
  | { kind: "record"; record: Customer; system: "Northstar" | "LedgerDesk" }
  | { kind: "event"; event: AuditEvent }
  | { kind: "job" }
  | { kind: "conflict" }
  | { kind: "run" };

function currency(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value / 100);
}

function PageTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="pageTitle"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions ? <div className="pageActions">{actions}</div> : null}</header>;
}

function StatusPill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`statusPill ${kind.toLowerCase()}`}><i />{children}</span>;
}

function Metric({ label, value, note, testId }: { label: string; value: string | number; note: string; testId?: string }) {
  return <div className="metric"><span>{label}</span><strong data-testid={testId}>{value}</strong><small>{note}</small></div>;
}

export function OverviewPage() {
  const router = useRouter();
  const { state, ready, runAction, reset } = useWorkbench();
  const begin = () => { if (state.phase === "READY") runAction(); router.push("/workbench"); };
  return <div className="overviewPage pageEnter">
    <section className="welcomePanel">
      <div className="welcomeCopy">
        <span className="overline"><i className="liveDot" /> DETERMINISTIC RECOVERY LAB</span>
        <h1>Move customer data.<br/><span>Keep every decision visible.</span></h1>
        <p>Follow one controlled migration from field mapping to bidirectional sync. You will hit a real replayable timeout, recover from its durable checkpoint, and resolve a concurrent update without creating duplicates.</p>
        <div className="welcomeActions"><button className="heroAction" disabled={!ready} onClick={begin}><span>{state.phase === "READY" ? "Start guided run" : "Continue current run"}</span><b>Open workspace&nbsp; →</b></button><Link className="quietButton" href="/records">Browse run data</Link></div>
        <small className="boundaryNote">Northstar CRM and LedgerDesk are controlled browser simulations. No live vendor system, secrets, or customer data are connected.</small>
      </div>
      <div className="systemDiagram" aria-label="Controlled migration architecture">
        <div className="systemNode northstar"><i>N</i><span><b>Northstar CRM</b><small>CSV + JSON source</small></span></div>
        <div className="flowLine"><span /><b>typed contract</b><span /></div>
        <div className="systemNode ledger"><i>L</i><span><b>LedgerDesk</b><small>controlled destination</small></span></div>
        <div className="diagramFooter"><span>paginated import →</span><span>← cursor sync →</span><span>idempotent receipts</span></div>
      </div>
    </section>
    <section className="overviewGrid">
      <article className="runSummary elevatedPanel">
        <div className="panelTitle"><div><span>CURRENT RUN</span><h2>Recovery proof</h2></div><StatusPill kind={state.phase}>{state.phase}</StatusPill></div>
        <div className="runProgress"><div><span>Durable checkpoint</span><b>{state.checkpoint.cursor} of {state.source.length || 11}</b></div><progress max={state.source.length || 11} value={state.checkpoint.cursor}/></div>
        <div className="summaryMetrics"><Metric label="Receipts" value={state.receipts.length} note="stored writes"/><Metric label="Quarantine" value={state.quarantine.length} note="isolated rows"/><Metric label="Recovery" value={state.metrics.recoverySteps} note="explicit steps"/></div>
        <Link className="panelLink" href="/workbench">Inspect active stage <span>→</span></Link>
      </article>
      <article className="journeyPanel elevatedPanel">
        <div className="panelTitle"><div><span>WHAT YOU WILL PROVE</span><h2>Seven visible boundaries</h2></div><button className="subtleButton" onClick={reset}>Reset run</button></div>
        <div className="journeyList">{stages.map((stage, index) => <div key={stage.id}><i>{String(index + 1).padStart(2,"0")}</i><span><b>{stage.label}</b><small>{stage.detail}</small></span></div>)}</div>
      </article>
      <article className="evidencePanel elevatedPanel">
        <div className="panelTitle"><div><span>LIVE EVIDENCE</span><h2>Computed, not claimed</h2></div><Link href="/history">Audit history →</Link></div>
        <div className="evidenceRows"><div><span>Missing source IDs</span><b data-testid="missing-count">{state.metrics.missingRecords}</b></div><div><span>Physical duplicates</span><b data-testid="duplicate-count">{state.metrics.physicalDuplicates}</b></div><div><span>Divergent shared IDs</span><b>{state.metrics.divergentRecords}</b></div><div><span>Destination records</span><b>{state.destination.length}</b></div></div>
      </article>
    </section>
  </div>;
}

function Inspector({ selection, close }: { selection: InspectorSelection; close: () => void }) {
  const { state, resolve } = useWorkbench();
  let content: React.ReactNode;
  if (selection.kind === "mapping") {
    const sources = state.mapping[selection.key];
    const confidence = Math.round(state.mappingConfidence[selection.key] * 100);
    content = <><div className="inspectorEyebrow">FIELD MAPPING</div><h2>{selection.key}</h2><StatusPill kind={confidence < 90 ? "warning" : "success"}>{confidence}% confidence</StatusPill><dl><dt>Source aliases</dt><dd>{sources.map(item => <code key={item}>{item}</code>)}</dd><dt>Destination field</dt><dd><code>{selection.key}</code></dd><dt>Boundary behavior</dt><dd>{selection.key === "status" ? "Two source columns are accepted because the fixture changes schema after row 7." : "Value is normalized and validated before engine entry."}</dd></dl>{selection.key === "status" ? <div className="inspectorCallout"><b>Schema drift contained</b><p><code>account_status</code> changes to <code>account_state</code> on rows 8–13.</p></div> : null}</>;
  } else if (selection.kind === "record") {
    const r = selection.record;
    content = <><div className="inspectorEyebrow">{selection.system.toUpperCase()} RECORD</div><h2>{r.name}</h2><StatusPill kind={r.status === "active" ? "success" : "warning"}>{r.status}</StatusPill><dl><dt>External ID</dt><dd><code>{r.externalId}</code></dd><dt>Email</dt><dd>{r.email}</dd><dt>Plan / balance</dt><dd>{r.plan} · {currency(r.balanceCents)}</dd><dt>Version</dt><dd>v{r.version}, updated {r.updatedAt.slice(0,16).replace("T", " ")}Z</dd></dl></>;
  } else if (selection.kind === "event") {
    content = <><div className="inspectorEyebrow">AUDIT EVENT</div><h2>{selection.event.title}</h2><StatusPill kind={selection.event.kind}>{selection.event.kind}</StatusPill><dl><dt>Event ID</dt><dd><code>{selection.event.id}</code></dd><dt>Deterministic time</dt><dd><code>{selection.event.at}</code></dd><dt>Recorded detail</dt><dd>{selection.event.detail}</dd></dl></>;
  } else if (selection.kind === "job") {
    const job = state.failedJobs[0];
    content = <><div className="inspectorEyebrow">FAILED JOB</div><h2>{job?.id ?? "No failed job"}</h2>{job ? <><StatusPill kind={job.status}>{job.status.replaceAll("_", " ")}</StatusPill><dl><dt>Fault</dt><dd>Timeout after writing {job.sourceId}, before checkpoint acknowledgement.</dd><dt>Replay safety</dt><dd>{job.safeReplayReason}</dd><dt>Durable cursor</dt><dd><code>{state.checkpoint.cursor}</code> — replay restarts here.</dd></dl></> : <div className="inspectorEmpty">The deterministic timeout appears after the staged import begins.</div>}</>;
  } else if (selection.kind === "conflict") {
    const conflict = state.conflicts[0];
    content = <><div className="inspectorEyebrow">CONFLICT DECISION</div><h2>{conflict ? `${conflict.externalId} changed twice` : "No active conflict"}</h2>{conflict ? <><StatusPill kind="warning">MANUAL REVIEW</StatusPill><div className="versionCompare"><div><span>NORTHSTAR</span><b>{conflict.source.name}</b><small>{conflict.source.email}</small><button onClick={() => resolve("source")}>Choose source</button></div><div><span>LEDGERDESK</span><b>{conflict.destination.name}</b><small>{conflict.destination.email}</small><button onClick={() => resolve("destination")}>Choose destination</button></div></div><p className="policyText">Policy refuses silent last-write-wins because the cursor entries are one minute apart.</p></> : <div className="inspectorEmpty">A concurrent update will be held here after bidirectional sync.</div>}</>;
  } else {
    content = <><div className="inspectorEyebrow">RUN CONTEXT</div><h2>{state.runId}</h2><StatusPill kind={state.phase}>{state.phase}</StatusPill><dl><dt>Checkpoint</dt><dd>Page {state.checkpoint.page} of {state.checkpoint.totalPages || 4}, cursor {state.checkpoint.cursor}</dd><dt>Source cursor</dt><dd><code>{state.syncCursors.source}</code></dd><dt>Destination cursor</dt><dd><code>{state.syncCursors.destination}</code></dd><dt>Safety boundary</dt><dd>Browser-local deterministic state. No universal rollback or live connector claim.</dd></dl></>;
  }
  return <aside className="inspector" aria-label="Context inspector"><button className="inspectorClose" onClick={close} aria-label="Close inspector">×</button>{content}</aside>;
}

export function WorkbenchPage() {
  const { state, ready, runAction, actionLabel } = useWorkbench();
  const activeStage = state.phase === "READY" ? "map" : state.phase === "PREVIEWED" ? "validate" : state.phase === "INTERRUPTED" ? "resume" : state.phase === "MIGRATED" ? "sync" : state.phase === "CONFLICT" ? "reconcile" : "audit";
  const [stageChoice, setStageChoice] = useState<{ phase: string; id: string } | null>(null);
  const stage = stageChoice?.phase === state.phase ? stageChoice.id : activeStage;
  const [selection, setSelection] = useState<InspectorSelection>({ kind: "run" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const setStage = (id: string) => setStageChoice({ phase: state.phase, id });
  const select = (value: InspectorSelection) => { setSelection(value); setDrawerOpen(true); };
  return <div className="workbenchPage pageEnter">
    <PageTitle eyebrow="RUN WORKSPACE" title="Customer migration" description="Operate the current stage, inspect its evidence, and advance only when the recovery boundary is clear." actions={<><StatusPill kind={state.phase}>{state.phase}</StatusPill><button className="actionButton" disabled={!ready} onClick={runAction}>{actionLabel}<span>→</span></button></>}/>
    <div className="mobileStageNav">
      <div className="mobileStageTabs" aria-label="Pipeline stages">{stages.map((item,index)=><button key={item.id} className={stage===item.id?"active":""} onClick={()=>setStage(item.id)}><i>{index+1}</i>{item.label}</button>)}</div>
      <label className="stageJump"><span>All stages</span><select aria-label="Jump to pipeline stage" value={stage} onChange={(event)=>setStage(event.target.value)}>{stages.map((item,index)=><option key={item.id} value={item.id}>{index+1}. {item.label}</option>)}</select></label>
    </div>
    <div className="workspaceGrid">
      <aside className="stageRail" aria-label="Pipeline stages"><div className="railTitle">PIPELINE STAGES</div>{stages.map((item,index)=>{const current=item.id===activeStage; const chosen=item.id===stage; return <button key={item.id} onClick={()=>setStage(item.id)} className={`${chosen?"selected ":""}${current?"current":""}`}><i>{index<stages.findIndex(s=>s.id===activeStage)?"✓":String(index+1).padStart(2,"0")}</i><span><b>{item.label}</b><small>{item.detail}</small></span>{current?<em>NOW</em>:null}</button>})}</aside>
      <section className="taskSurface">
        <div className="surfaceBar"><div><span>Viewing</span><b>{stages.find(item=>item.id===stage)?.label}</b></div><button onClick={()=>select({kind:"run"})}>Inspect run context <span>↗</span></button></div>
        {(stage === "map" || stage === "validate") ? <MappingSurface select={select}/> : null}
        {(stage === "import" || stage === "resume") ? <ImportSurface select={select}/> : null}
        {(stage === "sync" || stage === "reconcile") ? <SyncSurface select={select}/> : null}
        {stage === "audit" ? <AuditSurface select={select}/> : null}
      </section>
      <div className={drawerOpen ? "inspectorWrap open" : "inspectorWrap"}><div className="drawerScrim" onClick={()=>setDrawerOpen(false)} /><Inspector selection={selection} close={()=>setDrawerOpen(false)}/></div>
    </div>
  </div>;
}

function MappingSurface({ select }: { select: (value: InspectorSelection) => void }) {
  const { state } = useWorkbench();
  return <div className="surfaceContent"><div className="surfaceHeading"><div><span>BOUNDARY CONTRACT</span><h2>Map source fields</h2><p>Review inferred aliases before any destination write. Select a row for its normalization rule.</p></div><span className="dataBadge">CSV · 12 ROWS</span></div><div className="tableToolbar"><b>7 mapped fields</b><span>{state.phase === "READY" ? "Preview not yet parsed" : `${state.source.length} valid rows · ${state.quarantine.length} quarantined`}</span></div><div className="dataTable mappingGrid"><div className="tableHeader"><span>Source field</span><span>Destination</span><span>Confidence</span><span>State</span></div>{Object.entries(state.mapping).map(([target,sources])=>{const key=target as keyof FieldMapping; const confidence=Math.round(state.mappingConfidence[key]*100); return <button className="tableRow" key={target} onClick={()=>select({kind:"mapping",key})}><code>{sources.join(" / ")}</code><b>→ {target}</b><span className="confidence"><i style={{width:`${confidence}%`}} />{confidence}%</span><StatusPill kind={confidence<90?"warning":"success"}>{confidence<90?"Review":"Mapped"}</StatusPill></button>})}</div><div className="issueStrip"><span>!</span><div><b>Source schema drift detected</b><p><code>account_status</code> changes to <code>account_state</code> after row 7. The reviewed alias contains it.</p></div><button onClick={()=>select({kind:"mapping",key:"status"})}>Inspect drift</button></div>{state.quarantine.length ? <div className="quarantinePreview"><div><span>QUARANTINE</span><b>Row {state.quarantine[0].rowNumber}: invalid email</b><small>{state.quarantine[0].raw.email_address} · excluded before destination write</small></div><StatusPill kind="error">ISOLATED</StatusPill></div> : <div className="emptyState compact"><span>◇</span><div><b>Row validation appears after inspection</b><p>Run the mapping preview to parse the fixture through the typed customer contract.</p></div></div>}</div>;
}

function ImportSurface({ select }: { select: (value: InspectorSelection) => void }) {
  const { state } = useWorkbench();
  const total = state.source.length || 11;
  return <div className="surfaceContent"><div className="surfaceHeading"><div><span>DURABLE EXECUTION</span><h2>Import customer batches</h2><p>Pages commit receipts before checkpoint acknowledgement, making the injected timeout replayable.</p></div><StatusPill kind={state.failedJobs.some(j=>j.status==="FAILED_REPLAYABLE")?"error":"success"}>{state.failedJobs.length?state.failedJobs[0].status.replaceAll("_"," "):"AWAITING RUN"}</StatusPill></div><div className="progressCard"><div className="progressTop"><span>Write customer batches</span><b>{state.checkpoint.cursor} / {total} records</b></div><progress max={total} value={state.checkpoint.cursor}/><div className="progressFacts"><span>Page <b>{state.checkpoint.page}/{state.checkpoint.totalPages || 4}</b></span><span>Batch size <b>3</b></span><span>Requests <b>{state.metrics.requests}</b></span><span>Backoff <b>{state.metrics.simulatedBackoffMs} ms</b></span></div></div>{state.failedJobs.length ? state.failedJobs.map(job=><button className="jobRow" key={job.id} onClick={()=>select({kind:"job"})}><span className={job.status==="RECOVERED"?"jobIcon recovered":"jobIcon"}>{job.status==="RECOVERED"?"✓":"!"}</span><div><b>{job.status==="RECOVERED"?"Recovered failure":"Replayable failure"}</b><p>Timeout after destination write · {job.sourceId}</p><small>{job.safeReplayReason}</small></div><span>Inspect →</span></button>) : <div className="emptyState"><span>↻</span><div><b>No failed job yet</b><p>Starting the import injects one deterministic timeout after the seventh source write.</p></div></div>}<div className="receiptGrid"><div><span>IDEMPOTENCY RECEIPTS</span><b>{state.receipts.length}</b><small>Stored before acknowledgement</small></div><div><span>WRITES PREVENTED</span><b>{state.metrics.duplicateWritesPrevented}</b><small>Matched receipt on replay</small></div><div><span>PHYSICAL DUPLICATES</span><b data-testid="duplicate-count">{state.metrics.physicalDuplicates}</b><small>Computed destination rows</small></div></div></div>;
}

function SyncSurface({ select }: { select: (value: InspectorSelection) => void }) {
  const { state } = useWorkbench();
  return <div className="surfaceContent"><div className="surfaceHeading"><div><span>BIDIRECTIONAL SYNC</span><h2>Advance durable cursors</h2><p>Apply independent source and destination feeds, then hold shared changes for an explicit decision.</p></div><span className="dataBadge">CYCLE {state.syncCursors.cycle}</span></div><div className="cursorFlow"><div><span>NORTHSTAR CURSOR</span><code>{state.syncCursors.source}</code></div><i>⇄</i><div><span>LEDGERDESK CURSOR</span><code>{state.syncCursors.destination}</code></div></div>{state.conflicts.length ? state.conflicts.map(conflict=><button className="conflictRow" key={conflict.externalId} onClick={()=>select({kind:"conflict"})}><span>≠</span><div><b>{conflict.externalId} changed in both systems</b><p>{conflict.source.name} / {conflict.source.email} versus {conflict.destination.name} / {conflict.destination.email}</p></div><strong>Resolve conflict →</strong></button>) : <div className="emptyState"><span>≠</span><div><b>No unresolved conflict</b><p>{state.phase === "RECONCILED" ? "Both controlled systems match after the recorded operator decision." : "Run bidirectional sync to compare source and destination cursor entries."}</p></div></div>}<div className="receiptGrid reconcileMetrics"><div><span>MISSING</span><b data-testid="missing-count">{state.metrics.missingRecords}</b><small>unique source IDs</small></div><div><span>PHYSICAL DUPLICATES</span><b data-testid="duplicate-count">{state.metrics.physicalDuplicates}</b><small>destination rows</small></div><div><span>DESTINATION-ONLY</span><b>{state.metrics.destinationOnlyRecords}</b><small>extra destination IDs</small></div><div><span>DIVERGENT</span><b>{state.metrics.divergentRecords}</b><small>shared IDs</small></div></div></div>;
}

function AuditSurface({ select }: { select: (value: InspectorSelection) => void }) {
  const { state, download } = useWorkbench();
  return <div className="surfaceContent"><div className="surfaceHeading"><div><span>APPEND-ONLY PROOF</span><h2>Audit current run</h2><p>Export the exact state, receipts, decisions, computed metrics, and synthetic-system disclosure.</p></div><button className="secondaryAction" onClick={download}>Download JSON ↓</button></div><div className="auditSummary"><StatusPill kind={state.phase}>{state.phase}</StatusPill><h3>{state.events.length} events · {state.receipts.length} receipts · cycle {state.syncCursors.cycle}</h3><p>No universal rollback claim: writes are staged and recoverable through idempotent replay; external irreversible effects are outside this simulation.</p></div><div className="miniTimeline">{[...state.events].reverse().slice(0,6).map(event=><button key={event.id} onClick={()=>select({kind:"event",event})}><i className={event.kind.toLowerCase()}/><span><b>{event.title}</b><small>{event.at.slice(11,19)}Z · {event.kind}</small></span><em>→</em></button>)}</div></div>;
}

export function RecordsPage() {
  const { state, runAction, actionLabel, ready } = useWorkbench();
  const [system, setSystem] = useState<"source"|"destination">("destination");
  const records = useMemo(()=>[...(system === "source" ? state.source : state.destination)].sort((a,b)=>a.externalId.localeCompare(b.externalId)),[state.destination,state.source,system]);
  const [selectedId,setSelectedId]=useState<string | null>(null);
  const selected=records.find(item=>item.externalId===selectedId) ?? records[0];
  return <div className="recordsPage pageEnter"><PageTitle eyebrow="RECORD EXPLORER" title="Customer records" description="Inspect actual normalized source and destination rows from the current deterministic run." actions={<button className="actionButton" disabled={!ready} onClick={runAction}>{actionLabel}<span>→</span></button>}/><div className="recordsLayout"><section className="recordsPanel"><div className="recordsToolbar"><div className="segmented" role="group" aria-label="Record system"><button className={system==="source"?"active":""} onClick={()=>setSystem("source")}>Northstar <b>{state.source.length}</b></button><button className={system==="destination"?"active":""} onClick={()=>setSystem("destination")}>LedgerDesk <b>{state.destination.length}</b></button></div><span>{records.length} records · sorted by external ID</span></div>{records.length ? <div className="dataTable recordTable"><div className="tableHeader"><span>ID</span><span>Customer</span><span>Plan</span><span>Status</span><span>Balance</span><span>Version</span></div>{records.map(record=><button className={selected?.externalId===record.externalId?"tableRow selected":"tableRow"} key={record.externalId} onClick={()=>setSelectedId(record.externalId)}><code>{record.externalId}</code><span><b>{record.name}</b><small>{record.email}</small></span><span>{record.plan}</span><StatusPill kind={record.status}>{record.status}</StatusPill><span>{currency(record.balanceCents)}</span><code>v{record.version}</code></button>)}</div> : <div className="emptyState large"><span>≡</span><div><b>No normalized records yet</b><p>Inspect the source mapping to parse and validate the 12-row CSV fixture.</p><Link href="/workbench">Open mapping workspace →</Link></div></div>}</section><aside className="recordDetail">{selected ? <><div className="inspectorEyebrow">SELECTED RECORD</div><h2>{selected.name}</h2><StatusPill kind={selected.status}>{selected.status}</StatusPill><dl><dt>External ID</dt><dd><code>{selected.externalId}</code></dd><dt>Email</dt><dd>{selected.email}</dd><dt>Plan</dt><dd>{selected.plan}</dd><dt>Balance</dt><dd>{currency(selected.balanceCents)}</dd><dt>Updated</dt><dd><code>{selected.updatedAt}</code></dd><dt>Version</dt><dd>v{selected.version}</dd></dl></> : <><div className="inspectorEyebrow">DETAIL PANE</div><h2>Choose a record</h2><p>Row-level fields and version metadata will appear here.</p></>}</aside></div></div>;
}

export function HistoryPage() {
  const { state, download, reset } = useWorkbench();
  const [selectedId,setSelectedId]=useState(state.events.at(-1)?.id ?? "evt-0");
  const selected=state.events.find(event=>event.id===selectedId) ?? state.events.at(-1);
  return <div className="historyPage pageEnter"><PageTitle eyebrow="AUDIT & REPLAY" title="Run history" description="Trace every parsed boundary, staged write, injected fault, recovery, and conflict decision." actions={<><button className="secondaryAction" onClick={reset}>Reset run</button><button className="actionButton" onClick={download}>Export audit <span>↓</span></button></>}/><div className="historyStats"><Metric label="Events" value={state.events.length} note="append-only entries"/><Metric label="Receipts" value={state.receipts.length} note="idempotency keys"/><Metric label="Requests" value={state.metrics.requests} note="simulated attempts"/><Metric label="Backoff" value={`${state.metrics.simulatedBackoffMs} ms`} note="deterministic delay"/></div><div className="historyLayout"><section className="eventList"><div className="listHeading"><b>Event stream</b><span>Oldest → newest</span></div>{state.events.map(event=><button key={event.id} className={selected?.id===event.id?"eventRow selected":"eventRow"} onClick={()=>setSelectedId(event.id)}><i className={event.kind.toLowerCase()}/><time>{event.at.slice(11,19)}Z</time><span><b>{event.title}</b><small>{event.detail}</small></span><StatusPill kind={event.kind}>{event.kind}</StatusPill></button>)}</section><aside className="eventDetail">{selected?<><div className="inspectorEyebrow">EVENT DETAIL</div><h2>{selected.title}</h2><StatusPill kind={selected.kind}>{selected.kind}</StatusPill><dl><dt>Event ID</dt><dd><code>{selected.id}</code></dd><dt>Deterministic time</dt><dd><code>{selected.at}</code></dd><dt>Detail</dt><dd>{selected.detail}</dd></dl></>:null}<div className="receiptList"><span>LATEST RECEIPTS</span>{state.receipts.slice(-5).reverse().map(receipt=><code key={receipt}>{receipt}</code>)}{!state.receipts.length?<p>Receipts appear after destination writes.</p>:null}</div></aside></div></div>;
}
