"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { WorkbenchStateSchema, type WorkbenchState } from "@/lib/contracts";
import { createInitialState, exportAudit, previewImport, resolveConflict, resumeMigration, runIncrementalSync, startMigration } from "@/lib/engine";

const STORAGE_KEY = "reconcile-lab:v1";

type ContextValue = {
  state: WorkbenchState;
  ready: boolean;
  runAction: () => void;
  actionLabel: string;
  reset: () => void;
  download: () => void;
  resolve: (winner: "source" | "destination") => void;
};

const WorkbenchContext = createContext<ContextValue | null>(null);

export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("useWorkbench must be used inside AppShell");
  return value;
}

const nav = [
  { href: "/", label: "Overview", icon: "⌂" },
  { href: "/workbench", label: "Run workspace", icon: "↳" },
  { href: "/records", label: "Records", icon: "≡" },
  { href: "/history", label: "History", icon: "◷" },
];

const phaseLabels: Record<WorkbenchState["phase"], string> = {
  READY: "Ready to inspect",
  PREVIEWED: "Mapping reviewed",
  INTERRUPTED: "Action required",
  MIGRATED: "Import complete",
  CONFLICT: "Decision required",
  RECONCILED: "Systems reconciled",
};

function downloadAudit(state: WorkbenchState) {
  const href = URL.createObjectURL(new Blob([exportAudit(state)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `reconcile-lab-${state.runId}.json`;
  link.click();
  URL.revokeObjectURL(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
        }
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
        : { label: "Download audit artifact", run: () => downloadAudit(state) };
    }
  }, [state]);

  const value = useMemo<ContextValue>(() => ({
    state,
    ready,
    runAction: action.run,
    actionLabel: action.label,
    reset: () => { window.localStorage.removeItem(STORAGE_KEY); setState(createInitialState()); },
    download: () => downloadAudit(state),
    resolve: (winner) => setState(resolveConflict(state, winner)),
  }), [action, ready, state]);

  return (
    <WorkbenchContext.Provider value={value}>
      <div className="appShell">
        <header className="globalHeader">
          <Link href="/" className="brand" aria-label="Reconcile Lab overview"><span className="brandMark">RL</span><span>Reconcile<span className="brandAccent">Lab</span></span></Link>
          <div className="headerRoute">Migration operations <span>/</span> customer accounts</div>
          <div className="environment"><span className="liveDot" />CONTROLLED ENV</div>
          <div className="headerRun"><span>Run</span><code>{state.runId.replace("run-synthetic-", "syn-")}</code></div>
          <button className="topAction" disabled={!ready} onClick={action.run}><span>{action.label}</span><b>→</b></button>
        </header>
        <aside className="sideNav" aria-label="Primary navigation">
          <div className="navLabel">Console</div>
          {nav.map((item) => {
            const active = pathname === item.href;
            return <Link key={item.href} href={item.href} className={active ? "navItem active" : "navItem"} aria-current={active ? "page" : undefined}><i>{item.icon}</i><span>{item.label}</span></Link>;
          })}
          <div className="sideStatus">
            <div className="navLabel">Current run</div>
            <span className={`phaseLamp phase-${state.phase.toLowerCase()}`} />
            <strong>{phaseLabels[state.phase]}</strong>
            <small>{state.checkpoint.cursor}/{state.source.length || 11} records · cycle {state.syncCursors.cycle}</small>
          </div>
          <a className="sourceLink" href="https://github.com/kanwarvig/reconcile-lab" target="_blank" rel="noreferrer">View source <span>↗</span></a>
        </aside>
        <div className="statusTicker" aria-label="Run status"><div><span>PIPELINE</span><b>{state.phase}</b><i>•</i><span>CHECKPOINT</span><b>{state.checkpoint.cursor}/{state.source.length || 11}</b><i>•</i><span>RECEIPTS</span><b>{state.receipts.length}</b><i>•</i><span>QUARANTINE</span><b>{state.quarantine.length}</b><i>•</i><span>SYNC CYCLE</span><b>{state.syncCursors.cycle}</b></div></div>
        <main className="routeCanvas">{children}</main>
        <nav className="mobileNav" aria-label="Mobile navigation">{nav.map((item) => <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}><i>{item.icon}</i><span>{item.label.split(" ")[0]}</span></Link>)}</nav>
        <button className="mobileAction" disabled={!ready} onClick={action.run}><span>{action.label}</span><b>→</b></button>
      </div>
    </WorkbenchContext.Provider>
  );
}
