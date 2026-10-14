import type { CatalogAsset, SceneObject, Transform } from "@replay-world/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "./api/client";
import type { ResolvedEdit } from "./assist/editIntent";
import { CatalogPanel } from "./components/CatalogPanel";
import { ChangeBar } from "./components/ChangeBar";
import { CreateObject } from "./components/CreateObject";
import { UnsavedChangesDialog, UpgradeReviewDialog } from "./components/Dialogs";
import { Inspector } from "./components/Inspector";
import { EditRejectedNotice, FileRejectedPanel, LoadErrorPanel, PlacementBanner } from "./components/Notices";
import { ObjectList } from "./components/ObjectList";
import { PhotoImport } from "./components/PhotoImport";
import { SourcePhoto } from "./components/SourcePhoto";
import { StartPanel } from "./components/StartPanel";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { FixtureBanner, ModelNotice, PlanOverlay, ViewToolbar, WalkHud } from "./components/ViewControls";
import type { Axis, CommandRequest, EditCommand } from "./editing/commands";
import type { Outcome } from "./editing/history";
import { copyId, copyName, instanceId, instanceName } from "./editing/newObjects";
import { serializeProject } from "./editing/projectFile";
import { quantizeMetres } from "./editing/units";
import { useAssistStatus } from "./hooks/useAssistStatus";
import { summarise, useCatalogModels } from "./hooks/useCatalogModels";
import { useHealth } from "./hooks/useHealth";
import { useProject } from "./hooks/useProject";
import type { CameraMode, CameraProbe, FixedView, ViewCommand } from "./scene/CameraRig";
import { type EditTool, SNAP_OFF, SNAP_ON } from "./scene/drag";
import type { HandleProbe } from "./scene/EditHandles";
import type { Vec3Tuple } from "./scene/fit";
import { isTyping, MODES } from "./scene/modes";
import type { GhostSpec } from "./scene/PlacementGhost";
import { worldBounds } from "./scene/placement";
import { SceneViewport } from "./scene/SceneViewport";

const client = createApiClient();

type Placement = { nonce: number; loadId: number } & (
  | { kind: "add"; assetId: string }
  | { kind: "duplicate"; sourceId: string }
  /** A generated asset not yet in the catalog: placing it adds both, as one undo step. */
  | { kind: "generated"; asset: CatalogAsset }
);

const START_SEEN_KEY = "rws.start.seen";

/** The guided start panel opens on a first visit; afterwards only from the Start button. */
function startSeen(): boolean {
  try {
    return window.localStorage.getItem(START_SEEN_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode): show it, nothing else depends on it
  }
}

function rememberStartSeen() {
  try {
    window.localStorage.setItem(START_SEEN_KEY, "1");
  } catch {
    // Not remembered; the panel simply opens again next time.
  }
}

const TOOL_KEYS: Record<string, EditTool> = { v: "select", m: "move", r: "rotate", s: "resize" };

const TOOL_HELP: Record<Exclude<EditTool, "select">, (snap: boolean) => string> = {
  move: (snap) => `Move: drag an arrow along X, Y or Z, or the yellow disc across the floor · snap ${snap ? "10 mm" : "1 mm"}`,
  rotate: (snap) => `Rotate: drag the ring to turn about the vertical axis · snap ${snap ? "15°" : "1°"}`,
  resize: (snap) => `Resize: drag a face handle; width and depth change symmetrically, height grows upwards · snap ${snap ? "10 mm" : "1 mm"}`,
};

/** Where a copy is first shown: beside the source along +X, clear of its footprint. */
function besideSource(source: SceneObject): [number, number] {
  const width = worldBounds(source).max.x - worldBounds(source).min.x;
  return [quantizeMetres(source.transform.position_m.x + width + 0.25, 10), source.transform.position_m.z];
}

export function App() {
  const health = useHealth(client);
  const session = useProject(client);
  const { scene, fileCheck, prompt, loadId, execute, undo, redo, save } = session;
  const project = scene.status === "loaded" ? scene.project : null;
  const source = scene.status === "loaded" ? scene.source : null;
  const { models, retry } = useCatalogModels(client, project);
  const { state: assist } = useAssistStatus(client);
  const assistOn = assist.status === "known" && assist.assist.available;
  const assistNote =
    assist.status === "known" ? assist.assist.message : assist.status === "checking" ? "Checking the assistant…" : assist.message;
  const [start, setStart] = useState(() => !startSeen());
  const [create, setCreate] = useState<"describe" | "builder" | null>(null);
  const [photoImport, setPhotoImport] = useState(false);
  const [rebuild, setRebuild] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const overlayOpen = start || create !== null || photoImport;
  // Selection and placement belong to the project they were made in.
  const [selection, setSelection] = useState<{ loadId: number; id: string | null }>({ loadId: 0, id: null });
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [tool, setTool] = useState<EditTool>("select");
  const [snapOn, setSnapOn] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [command, setCommand] = useState<ViewCommand | null>(null);
  const [pixelsPerMetre, setPixelsPerMetre] = useState<number | null>(null);
  const viewport = useRef<HTMLElement>(null);

  const selectedId = selection.loadId === loadId ? selection.id : null;
  const selected = project?.scene.objects.find((o) => o.id === selectedId) ?? null;
  const activePlacement = placement?.loadId === loadId ? placement : null;
  const summary = summarise(models);
  const editable = project !== null && mode !== "walk" && prompt === null && !overlayOpen;
  const snap = snapOn ? SNAP_ON : SNAP_OFF;

  const select = useCallback((id: string | null) => setSelection({ loadId, id }), [loadId]);

  const issue = useCallback((type: ViewCommand["type"], view?: FixedView) => {
    setCommand((current) => ({ type, nonce: (current?.nonce ?? 0) + 1, ...(view ? { view } : {}) }));
  }, []);
  // A fixed view is shown in orbit mode; from another mode it waits until the orbit camera exists.
  const pendingView = useRef<FixedView | null>(null);
  const showView = useCallback(
    (view: FixedView) => {
      if (mode === "orbit") return issue("fixed-view", view);
      pendingView.current = view;
      setMode("orbit");
    },
    [issue, mode],
  );
  useEffect(() => {
    if (mode !== "orbit" || !pendingView.current) return;
    const view = pendingView.current;
    pendingView.current = null;
    issue("fixed-view", view);
  }, [issue, mode]);

  // Camera state goes straight to a data attribute (for tests and debugging) instead of React
  // state, so the 3D scene does not re-render several times a second. Only the plan scale,
  // which the scale bar needs, is kept in state, and only when it changes noticeably.
  const onProbe = useCallback((probe: CameraProbe) => {
    if (viewport.current) viewport.current.dataset.camera = JSON.stringify(probe);
    const next = probe.pixelsPerMetre;
    if (next !== null) setPixelsPerMetre((prev) => (prev !== null && Math.abs(next - prev) / prev < 0.01 ? prev : next));
  }, []);

  const onHandleProbe = useCallback((probe: HandleProbe | null) => {
    if (!viewport.current) return;
    if (probe) viewport.current.dataset.handles = JSON.stringify(probe);
    else delete viewport.current.dataset.handles;
  }, []);

  /** Run one command; select what it created, clear what it removed. */
  const run = useCallback(
    (request: CommandRequest): Outcome | null => {
      const outcome = execute(request);
      if (outcome?.ok) {
        setRejection(null);
        const c = request.command;
        if (c.type === "add_instance" || c.type === "duplicate_object" || c.type === "add_generated_instance") select(c.objectId);
        else if (c.type === "remove_object") select(null);
      }
      return outcome;
    },
    [execute, select],
  );

  /** Handles and placement: a rejection is shown as a notice. */
  const runAndReport = useCallback(
    (request: CommandRequest) => {
      const outcome = run(request);
      if (outcome && !outcome.ok && outcome.rejection.kind !== "no_change") setRejection(outcome.rejection.message);
      return outcome;
    },
    [run],
  );

  /** Inspector fields: the rejection is shown beside the field. */
  const runFromField = useCallback(
    (cmd: EditCommand): string | null => {
      if (!project) return "No project is loaded.";
      const outcome = run({ baseRevision: project.scene.revision, command: cmd });
      return outcome && !outcome.ok && outcome.rejection.kind !== "no_change" ? outcome.rejection.message : null;
    },
    [project, run],
  );

  const step = useCallback(
    (direction: "undo" | "redo") => {
      if (dragging || prompt) return;
      const outcome = direction === "undo" ? undo() : redo();
      if (!outcome) return;
      if (!outcome.ok) {
        if (outcome.rejection.kind !== "no_change") setRejection(outcome.rejection.message);
        return;
      }
      setRejection(null);
      setPlacement(null);
      const id = outcome.change.objectId;
      select(outcome.state.project.scene.objects.some((o) => o.id === id) ? id : null);
    },
    [dragging, prompt, undo, redo, select],
  );

  const startDuplicate = useCallback(() => {
    if (!selected || !editable) return;
    setPlacement((p) => ({ nonce: (p?.nonce ?? 0) + 1, loadId, kind: "duplicate", sourceId: selected.id }));
  }, [editable, loadId, selected]);

  const startPlace = useCallback(
    (asset: CatalogAsset) => setPlacement((p) => ({ nonce: (p?.nonce ?? 0) + 1, loadId, kind: "add", assetId: asset.id })),
    [loadId],
  );

  /** A reviewed generated asset is ready: place it (adding it to the catalog if it is new). */
  const startGenerated = useCallback(
    (asset: CatalogAsset) => {
      setCreate(null);
      if (mode === "walk") setMode("orbit");
      const known = project?.catalog.some((a) => a.id === asset.id) ?? false;
      setPlacement((p) => ({
        nonce: (p?.nonce ?? 0) + 1,
        loadId,
        ...(known ? { kind: "add" as const, assetId: asset.id } : { kind: "generated" as const, asset }),
      }));
    },
    [loadId, mode, project],
  );

  const closeStart = useCallback(() => {
    rememberStartSeen();
    setStart(false);
  }, []);

  /** Apply a language edit that the user has seen; the engine checks it against its revision. */
  const applyLanguageEdit = useCallback(
    (edit: ResolvedEdit): string | null => {
      // The change card reports a refusal itself, so no separate notice is raised.
      const outcome = run({ baseRevision: edit.baseRevision, command: edit.command });
      if (!outcome) return "No project is loaded.";
      if (!outcome.ok) return outcome.rejection.message;
      if (edit.command.type === "set_transform") select(edit.command.objectId);
      return null;
    },
    [run, select],
  );

  const rebuildModels = useCallback(async () => {
    if (!project) return;
    setRebuild({ busy: true, message: null });
    const report = await client.restoreGeneratedModels(serializeProject(project));
    if (!report.ok) return setRebuild({ busy: false, message: report.error.message });
    const mismatched = report.value.results.filter((r) => r.status === "mismatch");
    const restored = report.value.results.filter((r) => r.status === "restored").length;
    setRebuild({
      busy: false,
      message: mismatched.length
        ? mismatched.map((r) => `${r.asset_id}: ${r.message}`).join(" ")
        : `Rebuilt ${restored} generated model${restored === 1 ? "" : "s"} from the recorded specifications; hashes match.`,
    });
    retry();
  }, [project, retry]);

  const remove = useCallback(() => {
    if (!selected || !project || !editable) return;
    runAndReport({ baseRevision: project.scene.revision, command: { type: "remove_object", objectId: selected.id } });
  }, [editable, project, runAndReport, selected]);

  const ghost: GhostSpec | null = useMemo(() => {
    if (!activePlacement || !project) return null;
    if (activePlacement.kind === "add" || activePlacement.kind === "generated") {
      const asset = activePlacement.kind === "generated" ? activePlacement.asset : project.catalog.find((a) => a.id === activePlacement.assetId);
      if (!asset) return null;
      const d = asset.nominal_dimensions;
      return { nonce: activePlacement.nonce, label: asset.name, size: [d.width.value_m, d.height.value_m, d.depth.value_m], rotation: [0, 0, 0, "XYZ"], y: 0, start: null };
    }
    const src = project.scene.objects.find((o) => o.id === activePlacement.sourceId);
    if (!src) return null;
    const { width, height, depth } = src.dimensions;
    const r = src.transform.rotation_rad;
    return {
      nonce: activePlacement.nonce,
      label: `copy of ${src.name}`,
      size: [width.value_m, height.value_m, depth.value_m],
      rotation: [r.x, r.y, r.z, r.order],
      y: src.transform.position_m.y,
      start: besideSource(src),
    };
  }, [activePlacement, project]);

  const place = useCallback(
    ([x, y, z]: Vec3Tuple) => {
      if (!project || !activePlacement) return;
      let cmd: EditCommand;
      if (activePlacement.kind === "generated") {
        const asset = activePlacement.asset;
        const transform: Transform = { position_m: { x, y, z }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } };
        cmd = { type: "add_generated_instance", asset, objectId: instanceId(project, asset), name: instanceName(project, asset), transform };
      } else if (activePlacement.kind === "add") {
        const asset = project.catalog.find((a) => a.id === activePlacement.assetId);
        if (!asset) return;
        const transform: Transform = { position_m: { x, y, z }, rotation_rad: { order: "XYZ", x: 0, y: 0, z: 0 } };
        cmd = { type: "add_instance", assetId: asset.id, objectId: instanceId(project, asset), name: instanceName(project, asset), transform };
      } else {
        const src = project.scene.objects.find((o) => o.id === activePlacement.sourceId);
        if (!src) return;
        const transform: Transform = { position_m: { x, y, z }, rotation_rad: { ...src.transform.rotation_rad } };
        cmd = { type: "duplicate_object", sourceId: src.id, objectId: copyId(project, src), name: copyName(project, src), transform };
      }
      if (runAndReport({ baseRevision: project.scene.revision, command: cmd })?.ok) setPlacement(null);
    },
    [activePlacement, project, runAndReport],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (prompt || overlayOpen || isTyping(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z") {
          e.preventDefault();
          step(e.shiftKey ? "redo" : "undo");
        } else if (key === "y") {
          e.preventDefault();
          step("redo");
        } else if (key === "s") {
          e.preventDefault();
          if (!dragging) save();
        } else if (key === "d") {
          e.preventDefault();
          startDuplicate();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || dragging) return;
      if (activePlacement) {
        if (e.key === "Escape") setPlacement(null);
        return; // Enter is handled by the placement marker
      }
      const choice = MODES.find((m) => m.key === e.key);
      const lower = e.key.toLowerCase();
      if (choice) setMode(choice.id);
      else if (lower === "f") {
        if (selected) issue("frame-selection");
      } else if (lower === "h" || e.key === "Home") issue("frame-all");
      else if (mode === "walk") {
        if (lower === "r") issue("reset-walk");
        else if (e.key === "Escape") setMode("orbit");
      } else if (lower in TOOL_KEYS && editable) setTool(TOOL_KEYS[lower]!);
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePlacement, dragging, editable, issue, mode, overlayOpen, prompt, remove, save, select, selected, startDuplicate, step]);

  const help = MODES.find((m) => m.id === mode)!.help;
  const hint = mode !== "walk" && tool !== "select" && selected ? TOOL_HELP[tool](snapOn) : help;

  return (
    <div className="app">
      <TopBar
        scene={scene}
        fixtureName={source?.kind === "fixture" || scene.status !== "loaded" ? session.fixtureName : null}
        health={health}
        fileCheck={fileCheck}
        dirty={session.dirty}
        undoLabel={session.undoLabel}
        redoLabel={session.redoLabel}
        busy={dragging || prompt !== null}
        onUndo={() => step("undo")}
        onRedo={() => step("redo")}
        onSave={() => save()}
        onOpenFile={(file) => void session.openFile(file)}
        onLoadFixture={session.loadFixture}
        onStart={() => setStart(true)}
      />
      <aside className="panel panel-left">
        <ObjectList project={project} selectedId={selected?.id ?? null} onSelect={select} />
        {project && (
          <CatalogPanel
            project={project}
            placingAssetId={activePlacement?.kind === "add" ? activePlacement.assetId : null}
            editable={editable}
            onPlace={startPlace}
            onCancel={() => setPlacement(null)}
            onDescribe={() => setCreate("describe")}
            onBuild={() => setCreate("builder")}
          />
        )}
      </aside>
      <main
        ref={viewport}
        className="viewport"
        aria-label="3D scene"
        data-testid="viewport"
        data-renderer={project && rendererReady ? "ready" : "pending"}
        data-camera-mode={mode}
        data-models={`${summary.ready}/${summary.total} ready, ${summary.failed} failed`}
        data-dragging={dragging ? "true" : "false"}
      >
        {project && (
          <SceneViewport
            project={project}
            documentKey={loadId}
            models={models}
            mode={mode}
            command={command}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onReady={() => setRendererReady(true)}
            onProbe={onProbe}
            planPixelsPerMetre={pixelsPerMetre}
            editable={editable}
            tool={tool}
            snap={snap}
            placement={editable ? ghost : null}
            onPlace={place}
            onCommand={runAndReport}
            onDragChange={setDragging}
            onHandleProbe={onHandleProbe}
          />
        )}
        <div className="viewport-overlays">
          {project?.fixture && <FixtureBanner fixture={project.fixture} edited={project.scene.edit_log.length > 0} />}
          {ghost && editable && <PlacementBanner label={ghost.label} onCancel={() => setPlacement(null)} />}
          {rejection && <EditRejectedNotice message={rejection} onDismiss={() => setRejection(null)} />}
          {project && (
            <ModelNotice catalog={project.catalog} models={models} onRetry={retry} onRebuild={() => void rebuildModels()} rebuild={rebuild} />
          )}
          {scene.status === "loading" && <div className="notice">Loading scene from the API…</div>}
          {scene.status === "error" && <LoadErrorPanel error={scene.error} onRetry={session.reloadFixture} />}
          {fileCheck.status === "rejected" && (
            <FileRejectedPanel
              filename={fileCheck.filename}
              error={fileCheck.error}
              sceneKept={project !== null}
              restorable={fileCheck.restorable !== null}
              restore={fileCheck.restore}
              onRestore={() => void session.restoreAndReopen()}
              photoMissing={fileCheck.photoMissing}
              onAttachPhoto={(file) => void session.attachPhotoAndReopen(file)}
              onOpenWithoutPhoto={() => void session.openWithoutPhoto()}
              onDismiss={session.dismissFileCheck}
            />
          )}
        </div>
        {project && (
          <ViewToolbar
            mode={mode}
            hasSelection={selected !== null}
            onMode={setMode}
            onFrameSelection={() => issue("frame-selection")}
            onFrameAll={() => issue(mode === "walk" ? "reset-walk" : "frame-all")}
          />
        )}
        {project && mode === "top" && <PlanOverlay pixelsPerMetre={pixelsPerMetre} />}
        {project && mode === "walk" && <WalkHud onReset={() => issue("reset-walk")} onExit={() => setMode("orbit")} />}
        {project && <SourcePhoto key={`photo-${loadId}`} client={client} project={project} selectedId={selected?.id ?? null} onSelect={select} onView={showView} missingFiles={source?.kind === "file" ? source.report.missing_source_files : []} />}
        {project && mode !== "walk" && !activePlacement && (
          <ChangeBar
            key={loadId}
            client={client}
            project={project}
            selectedId={selected?.id ?? null}
            available={assistOn && editable}
            note={assistNote}
            onApply={applyLanguageEdit}
            onSelect={select}
          />
        )}
        {project && mode !== "walk" && (
          <p className="viewport-hint" data-testid="viewport-hint">
            {hint} · <kbd>F</kbd> frame selection · <kbd>H</kbd> frame all
          </p>
        )}
      </main>
      <aside className="panel panel-right">
        <Inspector
          project={project}
          source={source}
          selected={selected}
          models={models}
          edit={{
            tool,
            snap: snapOn,
            editable,
            onTool: setTool,
            onSnap: setSnapOn,
            onTransform: (transform) => (selected ? runFromField({ type: "set_transform", objectId: selected.id, transform }) : null),
            onDimensions: (values: Partial<Record<Axis, number>>) =>
              selected ? runFromField({ type: "set_dimensions", objectId: selected.id, values }) : null,
            onDuplicate: startDuplicate,
            onRemove: remove,
          }}
        />
      </aside>
      <StatusBar project={project} mode={mode} models={summary} savedAs={session.savedAs} dirty={session.dirty} />
      {prompt?.kind === "unsaved" && project && (
        <UnsavedChangesDialog
          action={prompt.action}
          revision={project.scene.revision}
          onSave={() => session.resolveUnsaved("save")}
          onDiscard={() => session.resolveUnsaved("discard")}
          onCancel={() => session.resolveUnsaved("cancel")}
        />
      )}
      {start && !prompt && (
        <StartPanel
          apiOnline={health.status === "online"}
          onExplore={() => {
            closeStart();
            if (source?.kind !== "fixture" || source.name !== "industrial-demo") session.loadFixture("industrial-demo");
            else issue("frame-all");
          }}
          onDescribe={() => {
            closeStart();
            setCreate("describe");
          }}
          onBuild={() => {
            closeStart();
            setCreate("builder");
          }}
          onPhoto={() => {
            closeStart();
            setPhotoImport(true);
          }}
          onOpenFile={(file) => {
            closeStart();
            void session.openFile(file);
          }}
          onClose={closeStart}
        />
      )}
      {photoImport && !prompt && (
        <PhotoImport
          client={client}
          assist={assist}
          onClose={() => setPhotoImport(false)}
          onCreated={(created, filename) => {
            setPhotoImport(false);
            if (mode === "walk") setMode("orbit");
            session.loadCreated(created, filename);
          }}
        />
      )}
      {create && !prompt && (
        <CreateObject client={client} assist={assist} startWith={create} onPlace={startGenerated} onClose={() => setCreate(null)} />
      )}
      {prompt?.kind === "upgrade" && (
        <UpgradeReviewDialog
          filename={prompt.filename}
          report={prompt.report}
          savedAs={prompt.savedAs}
          onOpen={session.openUpgraded}
          onSave={session.saveUpgraded}
          onCancel={session.closePrompt}
        />
      )}
    </div>
  );
}
