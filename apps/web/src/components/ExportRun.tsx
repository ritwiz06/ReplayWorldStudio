// "Export this run" (REL-01): the export review. It lists exactly what will be in the bundle:
// the texts the app writes, and each source and model file the project names, with where that
// file stands. Files that are part of this repository (the synthetic sample's drawing) are
// selected; a person's own drawings, photos and models are not, until they tick them. A file
// that is missing or changed cannot be included, and the bundle says what that means for
// replaying. Summary only leaves the project out entirely. The Voyager key is never read.
import type { EvidenceAsset, Project } from "@replay-world/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { downloadBlob, serializeProject } from "../editing/projectFile";
import type { DayRun } from "../run/day";
import { buildEvidence, bundleFileName } from "../run/evidence";

interface Props {
  client: ApiClient;
  project: Project;
  runs: DayRun[];
  onClose: () => void;
}

const STATUS_WORDS: Record<EvidenceAsset["status"], string> = {
  repo_owned: "part of this repository (synthetic sample file), checked by its sha256",
  library: "your own file in this computer's library: included only if you tick it",
  missing: "not on this computer: cannot be included",
  changed: "differs from the file the project records: cannot be included",
};

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function ExportRun({ client, project, runs, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<EvidenceAsset[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [include, setInclude] = useState<string[]>([]);
  const [summaryOnly, setSummaryOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; bytes: number } | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    client.exportInventory(serializeProject(project), controller.signal).then(
      (result) => {
        if (!result.ok) return setProblem(result.error.message);
        setAssets(result.value.assets);
        setInclude(result.value.assets.filter((a) => a.status === "repo_owned").map((a) => a.uri));
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [client, project]);

  const usable = (a: EvidenceAsset) => a.status === "repo_owned" || a.status === "library";
  const replay = !assets ? null : summaryOnly ? "summary_only" : assets.every((a) => include.includes(a.uri)) ? "full" : "runs_only";
  const texts = useMemo(
    () => [
      "README.md: what is in the bundle, and how to open it and run it again",
      "summary.md: what changed, what happened and why, and the basis of every number",
      "manifest.json: every file's sha256; contract, engine, seed and fingerprints",
      ...(summaryOnly ? [] : ["project.json: the reviewed layout, its process and edit record"]),
      ...runs.flatMap((r) => [`runs/${r.layout}/events.json: the ${r.layout} layout's event log`, `runs/${r.layout}/metrics.json: its routes and results`]),
    ],
    [runs, summaryOnly],
  );

  async function exportNow() {
    if (!assets) return;
    setBusy(true);
    setProblem(null);
    const body = buildEvidence(project, runs, assets, { include, summaryOnly });
    const result = await client.exportBundle(body);
    setBusy(false);
    if (!result.ok) return setProblem(result.error.message);
    const name = bundleFileName(project, runs);
    downloadBlob(name, result.value);
    setDone({ name, bytes: result.value.size });
  }

  return (
    <dialog
      ref={dialog}
      className="modal export-run"
      aria-labelledby="export-title"
      data-testid="export-run"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="create-head">
        <h2 id="export-title">Export this run</h2>
        <button type="button" className="button" data-testid="export-close" onClick={onClose}>
          {done ? "Close" : "Cancel"}
        </button>
      </header>
      <p className="small muted">
        One ZIP that someone else can open in Replay World Studio and run again. Exporting reads the project; it does not change it. Nothing is uploaded anywhere: the ZIP is saved on this
        computer.
      </p>
      <fieldset>
        <legend>Always in the bundle</legend>
        <ul className="small export-list" data-testid="export-texts">
          {texts.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </fieldset>
      <fieldset>
        <legend>Files the project uses</legend>
        {!assets && !problem && <p className="small muted">Checking the files…</p>}
        {assets && assets.length === 0 && <p className="small muted">None: the project names no drawing, picture, photo or model file.</p>}
        {assets && (
          <ul className="export-assets">
            {assets.map((a) => (
              <li key={a.uri} data-testid={`export-asset-${a.kind}`} data-status={a.status}>
                <label>
                  <input
                    type="checkbox"
                    checked={!summaryOnly && include.includes(a.uri)}
                    disabled={summaryOnly || !usable(a)}
                    onChange={(e) => setInclude((list) => (e.target.checked ? [...list, a.uri] : list.filter((u) => u !== a.uri)))}
                  />{" "}
                  <strong>{a.label}</strong> <span className="small muted">({a.kind}{a.bytes ? `, ${kb(a.bytes)}` : ""})</span>
                </label>
                <div className="small muted">{STATUS_WORDS[a.status]}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Never included: the Voyager key, settings, other projects' files, or anything not listed here.</p>
      </fieldset>
      <label className="small export-summary-only">
        <input type="checkbox" data-testid="export-summary-only" checked={summaryOnly} onChange={(e) => setSummaryOnly(e.target.checked)} /> Summary only: leave the project out (the layout,
        its drawing reading and the process). The summary, event logs and metrics stay; nobody can run it again.
      </label>
      {replay && (
        <p className={`small ${replay === "full" ? "status-ok" : "status-warn"}`} data-testid="export-replay" data-replay={replay}>
          {replay === "full"
            ? "Full: anyone with Replay World Studio can open it, see the drawing and run both layouts again."
            : replay === "runs_only"
              ? "Runs only: the runs replay from the project file, which holds the reviewed layout, but the files left out cannot be shown or checked by the recipient."
              : "Summary only: cannot be opened or rerun."}
        </p>
      )}
      {problem && (
        <p className="small status-error" role="alert" data-testid="export-problem">
          {problem}
        </p>
      )}
      {done && (
        <p className="small status-ok" data-testid="export-done">
          Saved {done.name} ({kb(done.bytes)}). The project was not changed.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="button button-primary" data-testid="export-save" disabled={!assets || busy} onClick={() => void exportNow()}>
          {busy ? "Exporting…" : "Export ZIP"}
        </button>
      </div>
    </dialog>
  );
}
