import type { CatalogAsset, DrawingObject, ProcessModel, Project, SceneObject, SourceDocument, Transform } from "@replay-world/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "./api/client";
import type { ResolvedEdit } from "./assist/editIntent";
import { CatalogPanel } from "./components/CatalogPanel";
import { ChangeBar } from "./components/ChangeBar";
import { CreateObject } from "./components/CreateObject";
import { UnsavedChangesDialog, UpgradeReviewDialog } from "./components/Dialogs";
import { DrawingImport } from "./components/DrawingImport";
import { ImproveModel } from "./components/ImproveModel";
import { PhotoLook } from "./components/PhotoLook";
import { Inspector } from "./components/Inspector";
import { JourneyPanel } from "./components/JourneyPanel";
import { EditRejectedNotice, FileRejectedPanel, LoadErrorPanel, PlacementBanner } from "./components/Notices";
import { ObjectList } from "./components/ObjectList";
import { SelectionCard } from "./components/SelectionCard";
import { PhotoImport } from "./components/PhotoImport";
import { type RouteAsk, runChecks, sceneChecks } from "./checks/results";
import { type DrawingView, SourceDrawing } from "./components/SourceDrawing";
import { SourcePhoto } from "./components/SourcePhoto";
import { AboutPreview } from "./components/AboutPreview";
import { SampleGuide } from "./components/SampleGuide";
import { StartPanel } from "./components/StartPanel";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { FixtureBanner, ModelNotice, PlanOverlay, ReferenceNotice, ViewToolbar, WalkHud } from "./components/ViewControls";
import { referencesOf } from "./photo/reference";
import { compareWithDrawing } from "./drawing/compare";
import { type ReviewCorrection, reviewItems } from "./drawing/review";
import { SAMPLE_MACHINE, SAMPLE_MOVE_TO, SAMPLE_PROJECT_ID, SAMPLE_ROUTE } from "./drawing/sampleProject";
import { drawingSource, isPlanImage, toWorld } from "./drawing/world";
import { PUBLIC_PREVIEW } from "./config";
import { type Axis, type CommandRequest, canChangeLook, type EditCommand } from "./editing/commands";
import type { Outcome } from "./editing/history";
import { copyId, copyName, instanceId, instanceName } from "./editing/newObjects";
import { serializeProject } from "./editing/projectFile";
import { quantizeMetres } from "./editing/units";
import { useAssistStatus } from "./hooks/useAssistStatus";
import { summarise, useCatalogModels } from "./hooks/useCatalogModels";
import { equipmentToImprove } from "./matching/appearance";
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
import { RunBar } from "./components/RunBar";
import { GuidedSetup } from "./components/GuidedSetup";
import { RunLabels } from "./components/RunLabels";
import { RunPanel } from "./components/RunPanel";
import { ChatPanel } from "./components/ChatPanel";
import { SelectionChip } from "./components/SelectionChip";
import { DWG_MESSAGE, EmptyStart } from "./components/EmptyStart";
import { suggestions as chatSuggestions, symbolCandidates, type WorldFacts } from "./chat/context";
import { type ChatPreview, useChat } from "./chat/useChat";
import { footprint } from "./checks/geometry";
import { heightAssumed } from "./evidence";
import { frameBox } from "./scene/cameras";
import { sceneBounds } from "./scene/sceneBounds";
import type { AccentSpec } from "./scene/SceneViewport";
import { BundleCheck } from "./components/BundleCheck";
import { ExportRun } from "./components/ExportRun";
import { type ExampleProgress, ShowExample } from "./components/ShowExample";
import { SetupDay } from "./components/SetupDay";
import { usePlayback } from "./hooks/usePlayback";
import { compareDays, type DayComparison, type DayRun, operatingKey, runDay, runOriginal } from "./run/day";
import { bundleRuns, type Reproduction, reproduce } from "./run/evidence";
import { emptyGuided, type GuidedDraft, guidedFrom } from "./run/guided";

const client = createApiClient();

type Placement = { nonce: number; loadId: number } & (
  | { kind: "add"; assetId: string }
  | { kind: "duplicate"; sourceId: string }
  /** A generated asset not yet in the catalog: placing it adds both, as one undo step. */
  | { kind: "generated"; asset: CatalogAsset }
);

const START_SEEN_KEY = "rws.start.seen";
const DETAILS_KEY = "rws.details";

/** The advanced panels (object list, catalog, inspector) are shown when the person asked for
 * them last time; a first visit starts with the simple screen. */
function detailsPreferred(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDetails(shown: boolean) {
  try {
    window.localStorage.setItem(DETAILS_KEY, shown ? "1" : "0");
  } catch {
    // Not remembered; the simple screen shows next time.
  }
}

/** The guided start panel opens on a first visit; afterwards only from the Start button. */
function startSeen(): boolean {
  try {
    return window.localStorage.getItem(START_SEEN_KEY) === "1";
  } catch {
    return false; // storage unavailable (private mode): show it, nothing else depends on it
  }
}

const VIEW_KEY = "rws.view";

/** The chat-first screen (UX-03) unless the person last chose the full editor. */
function storedView(): "chat" | "editor" {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "editor" ? "editor" : "chat";
  } catch {
    return "chat";
  }
}

function rememberView(view: "chat" | "editor") {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered; the chat-first screen shows next time.
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

/** What to do with a tool chosen before any object is selected. */
const TOOL_FIRST: Record<Exclude<EditTool, "select">, string> = {
  move: "Move: click an object in the view or the list first, then drag the yellow disc across the floor",
  rotate: "Rotate: click an object in the view or the list first, then drag the ring",
  resize: "Resize: click an object in the view or the list first, then drag a face handle",
};

/** A plan picture laid on the 3D floor (IMP-03): its URL and its corners in world metres. */
function pictureOf(project: Project | null): { url: string; corners: { x: number; z: number }[] } | null {
  const source = project ? drawingSource(project) : null;
  const raster = source && isPlanImage(source.drawing) ? source.drawing.raster : null;
  if (!source || !raster) return null;
  const t = source.source_to_world;
  const corners = [
    { x: 0, y: 0 },
    { x: raster.width_px, y: 0 },
    { x: raster.width_px, y: raster.height_px },
    { x: 0, y: raster.height_px },
  ].map((p) => toWorld(t, p));
  return { url: client.sourceFileUrl(raster.uri), corners };
}

/** The source drawing's lines as floor-level segments in world metres, for the 3D underlay. */
function underlayOf(project: Project | null): Float32Array | null {
  const source = project ? drawingSource(project) : null;
  if (!source) return null;
  const t = source.source_to_world;
  const values: number[] = [];
  for (const line of source.drawing.lines) {
    const pts = line.points.map((p) => toWorld(t, p));
    const count = line.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      values.push(a.x, 0.009, a.z, b.x, 0.009, b.z);
    }
  }
  return new Float32Array(values);
}

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
  // The public preview opens on the sample (ADR-054); development opens on the demo.
  /** The chat-first screen or the full editor (UX-03): one App, one world, one history. */
  const [view, setViewState] = useState<"chat" | "editor">(() => (PUBLIC_PREVIEW ? "editor" : storedView()));
  const setView = useCallback((next: "chat" | "editor") => {
    rememberView(next);
    setViewState(next);
  }, []);
  const session = useProject(client, PUBLIC_PREVIEW ? "sample" : view === "chat" ? "empty" : "industrial-demo");
  const { scene, fileCheck, prompt, loadId, execute, undo, redo, save } = session;
  const project = scene.status === "loaded" ? scene.project : null;
  const source = scene.status === "loaded" ? scene.source : null;
  /** An opened evidence bundle (REL-01): what it recorded, to compare with runs made here. */
  const bundle = source?.kind === "file" ? (source.bundle ?? null) : null;
  /** One imported object drawn with a candidate model while its look is reviewed (UX-05): the
   * world shown, never the project edited, checked or run. */
  const [lookPreview, setLookPreview] = useState<{ loadId: number; revision: number; objectId: string; asset: CatalogAsset } | null>(null);
  const shown = useMemo(() => {
    const p = lookPreview;
    if (!project || !p || p.loadId !== loadId || p.revision !== project.scene.revision) return project;
    if (!project.scene.objects.some((o) => o.id === p.objectId)) return project;
    return {
      ...project,
      catalog: project.catalog.some((a) => a.id === p.asset.id) ? project.catalog : [...project.catalog, p.asset],
      scene: { ...project.scene, objects: project.scene.objects.map((o) => (o.id === p.objectId ? { ...o, asset_id: p.asset.id } : o)) },
    };
  }, [project, lookPreview, loadId]);
  const { models, retry } = useCatalogModels(client, shown);
  /** An object to frame once it is the selection (a model review brings it into view). */
  const frameAfter = useRef<string | null>(null);
  /** The same file again for a missing attached model (ENR-01), checked by its hash. */
  const sameFile = useRef<HTMLInputElement>(null);
  const sameTarget = useRef<CatalogAsset | null>(null);
  /** A .glb chosen for one object (ENR-01): the hidden file input and the object it is for. */
  const modelFile = useRef<HTMLInputElement>(null);
  const modelTarget = useRef<string | null>(null);
  /** Improve from photo (ENR-01): the object it is for and a photo already chosen, if any. */
  const [photoLook, setPhotoLook] = useState<{ objectId: string; file: File | null } | null>(null);
  /** Reference photos this session re-attached (checked by hash) after a file opened without them. */
  const [restoredRefs, setRestoredRefs] = useState<ReadonlySet<string>>(new Set());
  const refFile = useRef<HTMLInputElement>(null);
  const refTarget = useRef<SourceDocument | null>(null);
  const [refNotice, setRefNotice] = useState<string | null>(null);
  /** The object generator, opened for an existing object's look (UX-05). */
  const [lookCreate, setLookCreate] = useState<{ objectId: string; kind: "describe" | "builder"; initial: { text: string; name: string; size: { width: number; depth: number; height: number } }; done: (outcome: { ok: true; assetName: string } | { ok: false; message: string } | null) => void } | null>(null);
  const { state: assist } = useAssistStatus(client);
  const assistOn = assist.status === "known" && assist.assist.available;
  const assistNote =
    assist.status === "known" ? assist.assist.message : assist.status === "checking" ? "Checking the assistant…" : assist.message;
  // The preview's first screen is the sample with its guide, not the start panel.
  const [start, setStart] = useState(() => !PUBLIC_PREVIEW && !startSeen() && storedView() === "editor");
  const [about, setAbout] = useState(false);
  const [guideClosed, setGuideClosed] = useState(false);
  const [create, setCreate] = useState<"describe" | "builder" | null>(null);
  const [photoImport, setPhotoImport] = useState(false);
  const [drawingImport, setDrawingImport] = useState(false);
  const [drawingPanel, setDrawingPanel] = useState<{ open: boolean; view: DrawingView }>({ open: true, view: "review" });
  const [details, setDetailsState] = useState(detailsPreferred);
  const setDetails = useCallback((shown: boolean) => {
    rememberDetails(shown);
    setDetailsState(shown);
  }, []);
  /** A drawn object focused in the review that has no scene object (marked not an object). */
  const [reviewFocus, setReviewFocus] = useState<{ loadId: number; drawnId: string } | null>(null);
  const [underlayShown, setUnderlayShown] = useState(true);
  /** The route asked about in Check layout; kept while the app is open, not in the project. */
  const [routeAsk, setRouteAsk] = useState<RouteAsk | null>(null);
  /** The object whose generated model is being improved. */
  const [improve, setImprove] = useState<string | null>(null);
  const [rebuild, setRebuild] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  /** Run a day (SIM): the run made for this document, the comparison with the original layout,
   * whether the run is shown in the 3D view, and the Set up a day dialog. */
  const [day, setDay] = useState<{ loadId: number; run: DayRun } | null>(null);
  const [dayComparison, setDayComparison] = useState<{ key: string; original: DayRun; result: DayComparison } | null>(null);
  const [runShown, setRunShown] = useState(false);
  const [pendingRun, setPendingRun] = useState(false);
  const [setupDay, setSetupDay] = useState(false);
  /** The process the full form starts from (the guided draft's, when opened from it). */
  const [setupFrom, setSetupFrom] = useState<ProcessModel | null>(null);
  /** The guided setup's draft, and whether it is open over an existing process. */
  const [guidedState, setGuidedState] = useState<{ loadId: number; draft: GuidedDraft; open: boolean } | null>(null);
  /** The run that should start playing as soon as it is shown. */
  const [autoPlayKey, setAutoPlayKey] = useState<string | null>(null);
  /** The conversation (UX-03): its emphasis in the world, whether it is folded away, the guided
   * setup shown inside it, the plan opened from it, and a picture attached to it. */
  const [chatPreview, setChatPreview] = useState<{ loadId: number; preview: ChatPreview } | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatSetup, setChatSetup] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ loadId: number; trace: boolean } | null>(null);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [symbolsAnswered, setSymbolsAnswered] = useState<number | null>(null);
  /** How objects look (display only): solid draft or the uncertainty view; see-through while a
   * shift plays. And whether the person has moved the camera in this document (then a run does
   * not reframe it). */
  const [appearance, setAppearance] = useState<"draft" | "uncertainty">("draft");
  const [seeThrough, setSeeThrough] = useState(false);
  const [cameraTouched, setCameraTouched] = useState<number | null>(null);
  /** A file being dragged over the world, and the reason the start screen refused one. */
  const [dropActive, setDropActive] = useState(false);
  const [startRefused, setStartRefused] = useState<string | null>(null);
  const chatFile = useRef<HTMLInputElement>(null);
  const libraryCache = useRef<Promise<CatalogAsset[]> | null>(null);
  const [createInitial, setCreateInitial] = useState<{ text: string; name: string; size: { width: number | null; depth: number | null; height: number | null } } | null>(null);
  /** REL-01: the sample's step-by-step example, the export review, and an opened bundle's check. */
  const [example, setExample] = useState<{ loadId: number; progress: ExampleProgress } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bundleCheck, setBundleCheck] = useState<{ loadId: number; check: Reproduction } | null>(null);
  const overlayOpen = start || about || create !== null || photoImport || drawingImport || improve !== null || setupDay || exporting;
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

  const sourceDrawing = project ? drawingSource(project) : null;
  const underlay = useMemo(() => underlayOf(sourceDrawing ? project : null), [sourceDrawing]); // eslint-disable-line react-hooks/exhaustive-deps
  const picture = useMemo(() => pictureOf(sourceDrawing ? project : null), [sourceDrawing]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewOpen = sourceDrawing !== null && reviewItems(sourceDrawing).some((item) => !item.done);
  const journeyStage = useMemo(() => {
    if (!project || !sourceDrawing || reviewOpen) return "upload" as const;
    const counts = compareWithDrawing(project)?.counts;
    return counts && counts.changed + counts.removed + counts.added > 0 ? ("compare" as const) : ("change" as const);
  }, [project, sourceDrawing, reviewOpen]);
  // The layout checks run while their results are on screen, again after every change.
  const checking = project !== null && sourceDrawing !== null && mode !== "walk" && drawingPanel.open && (drawingPanel.view === "check" || drawingPanel.view === "compare");
  const checks = useMemo(() => (checking && project ? runChecks(project, routeAsk) : null), [checking, project, routeAsk]);
  const highlights = useMemo(() => (checks && drawingPanel.view === "check" ? sceneChecks(checks.now, routeAsk) : null), [checks, drawingPanel.view, routeAsk]);
  const isSample = project?.id === SAMPLE_PROJECT_ID;
  const activeDay = day?.loadId === loadId ? day.run : null;
  // Out of date when what the run reads changed; a change of look alone (UX-05) is not one.
  const currentKey = useMemo(() => (project ? operatingKey(project, project.process) : null), [project]);
  const dayStale = activeDay !== null && project !== null && activeDay.operatingKey !== currentKey;
  const runKey = activeDay?.result ? `${loadId}:${activeDay.sceneRevision}:${activeDay.result.fingerprint}` : null;
  const playback = usePlayback(activeDay?.result && project?.process ? project.process.shift.duration_s.value * 1000 : 1, runKey, runKey !== null && runKey === autoPlayKey);
  const layoutEdited = useMemo(() => {
    const counts = project && sourceDrawing ? compareWithDrawing(project)?.counts : undefined;
    return counts !== undefined && counts.changed + counts.removed + counts.added > 0;
  }, [project, sourceDrawing]);
  const selectedId = selection.loadId === loadId ? selection.id : null;
  const focusedDrawn = reviewFocus?.loadId === loadId ? reviewFocus.drawnId : null;
  const selected = project?.scene.objects.find((o) => o.id === selectedId) ?? null;
  // Reference photos (ENR-01): those a file opened without, and the selected object's own.
  const missingFiles = source?.kind === "file" ? source.report.missing_source_files : [];
  const missingRefs = (project?.sources ?? []).filter((s) => s.kind === "reference_photo" && s.image && missingFiles.includes(s.image.uri) && !restoredRefs.has(s.image.uri));
  const selectedRef = selected ? referencesOf(project!, selected.id).at(-1) : undefined;
  const selectedReference = selectedRef?.image
    ? { filename: selectedRef.filename ?? "photo", url: missingRefs.includes(selectedRef) ? null : client.sourceFileUrl(selectedRef.image.uri) }
    : null;
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
    if (!selectedId || frameAfter.current !== selectedId) return;
    frameAfter.current = null;
    issue("frame-selection");
  }, [selectedId, issue]);
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

  // The sample opens ready to try: the aisle route asked, Check layout shown, Machine B selected
  // with the move tool (set once per load, during render rather than in an effect).
  const [sampleFor, setSampleFor] = useState<number | null>(null);
  const sampleMachine = isSample ? (project?.scene.objects.find((o) => o.name === SAMPLE_MACHINE) ?? null) : null;
  if (isSample && sourceDrawing && sampleFor !== loadId && view === "chat") {
    // The conversation keeps the sample's route question (so "will the route still fit?" has
    // one) but leaves the world as it is: no panel, selection or tool is chosen for the person.
    setSampleFor(loadId);
    setRouteAsk({ sourceId: sourceDrawing.id, start: SAMPLE_ROUTE.start, end: SAMPLE_ROUTE.end, width: SAMPLE_ROUTE.width, allowance: SAMPLE_ROUTE.allowance });
  } else if (isSample && sourceDrawing && sampleFor !== loadId) {
    setSampleFor(loadId);
    setRouteAsk({ sourceId: sourceDrawing.id, start: SAMPLE_ROUTE.start, end: SAMPLE_ROUTE.end, width: SAMPLE_ROUTE.width, allowance: SAMPLE_ROUTE.allowance });
    setDrawingPanel({ open: true, view: "check" });
    if (sampleMachine) setSelection({ loadId, id: sampleMachine.id });
    setTool("move");
    setGuideClosed(false);
  }
  // A bundle opens on the Run tab, where its check is (after the sample's own setup above).
  const [bundleFor, setBundleFor] = useState<number | null>(null);
  if (bundle && bundleFor !== loadId) {
    setBundleFor(loadId);
    setDrawingPanel({ open: true, view: "run" });
  }
  const sampleMoved = useMemo(
    () => (isSample && project && sampleMachine ? (compareWithDrawing(project)?.changes.find((c) => c.objectId === sampleMachine.id)?.status === "changed") : false),
    [isSample, project, sampleMachine],
  );
  const moveForMe = useCallback(
    (view: DrawingView = "check") => {
      if (!project || !sourceDrawing || !sampleMachine) return;
      const at = toWorld(sourceDrawing.source_to_world, SAMPLE_MOVE_TO);
      const transform = { ...sampleMachine.transform, position_m: { ...sampleMachine.transform.position_m, x: at.x, z: at.z } };
      run({ baseRevision: project.scene.revision, command: { type: "set_transform", objectId: sampleMachine.id, transform } });
      if (mode === "walk") setMode("orbit");
      setDrawingPanel({ open: true, view });
    },
    [mode, project, run, sampleMachine, sourceDrawing],
  );

  /** Open a project file, or an evidence bundle (a ZIP made by Export this run). */
  const openAny = useCallback(
    (file: File) => void (/\.zip$/i.test(file.name) || file.type === "application/zip" ? session.openBundle(file) : session.openFile(file)),
    [session],
  );

  /** Run the project's process on its layout as it is, and play it from the shift start. */
  const runOn = useCallback(
    (target: Project): DayRun | null => {
      if (!target.process) return null;
      const made = runDay(target, target.process, "edited");
      setDay({ loadId, run: made });
      setDayComparison(null);
      setRunShown(true);
      setAutoPlayKey(made.result ? `${loadId}:${made.sceneRevision}:${made.result.fingerprint}` : null);
      // A camera the person moved stays where they put it.
      if (mode !== "walk" && cameraTouched !== loadId) issue("frame-all");
      return made;
    },
    [cameraTouched, issue, loadId, mode],
  );
  /** Run a day: run the project's process on the layout as it is now (or open the sample hall
   * and its example shift when there is no reviewed plan), then play it from the shift start. */
  const startRun = useCallback(() => {
    if (!project) return;
    if (!sourceDrawing) {
      setPendingRun(true);
      session.loadFixture("sample");
      return;
    }
    setDrawingPanel({ open: true, view: "run" });
    runOn(project);
  }, [project, runOn, session, sourceDrawing]);
  if (pendingRun && isSample && sourceDrawing && project?.process && sampleFor === loadId) {
    setPendingRun(false);
    setDrawingPanel({ open: true, view: "run" });
    const made = runDay(project, project.process, "edited");
    setDay({ loadId, run: made });
    setDayComparison(null);
    setRunShown(true);
    setAutoPlayKey(made.result ? `${loadId}:${made.sceneRevision}:${made.result.fingerprint}` : null);
    issue("frame-all");
  }
  const compareDay = useCallback((): { original: DayRun; result: DayComparison } | null => {
    if (!project?.process || !activeDay || !runKey) return null;
    const original = runOriginal(project, project.process);
    if (!original) return null;
    const made = { original, result: compareDays(original, activeDay, project.process) };
    setDayComparison({ key: runKey, ...made });
    return made;
  }, [activeDay, project, runKey]);
  const exampleProgress = example?.loadId === loadId ? example.progress : null;
  /** One step of "Show the example": each is the app's own command or run, made now. */
  const exampleNext = useCallback(() => {
    if (!project?.process || !exampleProgress) return;
    const p = exampleProgress;
    const advance = (patch: Partial<ExampleProgress> = {}) => setExample({ loadId, progress: { ...p, ...patch, step: p.step + 1 } });
    setDrawingPanel({ open: true, view: "run" });
    if (p.step === 0 || p.step === 2) {
      const made = runOn(project);
      advance(p.step === 0 ? { first: made?.result?.fingerprint ?? null } : {});
    } else if (p.step === 1) {
      moveForMe("run");
      advance();
    } else if (p.step === 3) {
      compareDay();
      advance();
    } else if (p.step === 4) {
      const outcome = session.undo();
      if (!outcome?.ok) return;
      const made = runOn(outcome.state.project);
      advance({ again: made?.result?.fingerprint ?? null });
    }
  }, [compareDay, exampleProgress, loadId, moveForMe, project, runOn, session]);
  const exampleNode =
    isSample && project?.process && sourceDrawing ? (
      <ShowExample
        progress={exampleProgress}
        blocked={layoutEdited && !exampleProgress ? "The layout has been changed. Undo your changes (or reload the sample) to start from the hall as drawn." : null}
        onStart={() => setExample({ loadId, progress: { step: 0, first: null, again: null } })}
        onNext={exampleNext}
      />
    ) : null;
  /** The runs an export holds: the original layout's and, when the layout was edited, this one. */
  const exportRuns = useMemo(
    () => (project?.process && activeDay?.result && !dayStale ? bundleRuns(project, activeDay, layoutEdited, dayComparison?.key === runKey ? (dayComparison?.original ?? null) : null) : null),
    [activeDay, dayComparison, dayStale, layoutEdited, project, runKey],
  );
  const activeBundleCheck = bundleCheck?.loadId === loadId ? bundleCheck.check : null;
  const rerunBundle = useCallback(() => {
    if (!project || !bundle) return;
    const check = reproduce(project, bundle.manifest, bundle.events);
    setBundleCheck({ loadId, check });
    const current = check.runs.at(-1);
    if (!current?.result) return;
    // Show the last recorded run, and its comparison with the original, as the run made here.
    setDay({ loadId, run: current });
    const key = `${loadId}:${current.sceneRevision}:${current.result.fingerprint}`;
    if (check.runs.length === 2 && project.process) setDayComparison({ key, original: check.runs[0]!, result: compareDays(check.runs[0]!, current, project.process) });
    else setDayComparison(null);
    setRunShown(true);
    setAutoPlayKey(key);
    setDrawingPanel({ open: true, view: "run" });
  }, [bundle, loadId, project]);
  const bundleNode = bundle && source?.kind === "file" ? <BundleCheck filename={source.filename} bundle={bundle} check={activeBundleCheck} onRerun={rerunBundle} /> : null;
  const runLabels = useRef<HTMLDivElement>(null);
  const runShownNow = runShown && activeDay?.replay && !dayStale ? { replay: activeDay.replay, clock: playback.clock } : null;
  const runFrame = useMemo(() => (runShownNow ? runShownNow.replay.frame(playback.t) : null), [runShownNow?.replay, playback.t]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** A review correction (IMP-02) through the command engine; returns why it was refused. */
  const applyReview = useCallback(
    (correction: ReviewCorrection): string | null => {
      if (!project || !sourceDrawing) return "There is no drawing to review.";
      const outcome = run({ baseRevision: project.scene.revision, command: { type: "review_drawing", sourceId: sourceDrawing.id, correction } });
      if (!outcome) return "The scene is not editable right now.";
      if (!outcome.ok) return outcome.rejection.kind === "no_change" ? null : outcome.rejection.message;
      const id = outcome.change.objectId;
      if (correction.kind === "object" && correction.action === "not_an_object") {
        setReviewFocus({ loadId, drawnId: correction.drawnId });
        select(null);
      } else if (id && outcome.state.project.scene.objects.some((o) => o.id === id)) {
        setReviewFocus(null);
        if (correction.kind === "object" || correction.kind === "trace") select(id);
      }
      return null;
    },
    [loadId, project, run, select, sourceDrawing],
  );

  /** A drawn outline clicked on the plan: select its object, or focus it in the review. */
  const pickDrawn = useCallback(
    (drawn: DrawingObject) => {
      if (project?.scene.objects.some((o) => o.id === drawn.object_id)) {
        setReviewFocus(null);
        select(drawn.object_id);
      } else {
        select(null);
        setReviewFocus({ loadId, drawnId: drawn.id });
      }
    },
    [loadId, project, select],
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

  const attachSame = useCallback(
    async (file: File) => {
      const asset = sameTarget.current;
      if (!asset || asset.visual.type !== "gltf") return;
      setRebuild({ busy: true, message: null });
      const stored = await client.uploadModel(file, file.name);
      if (!stored.ok) return setRebuild({ busy: false, message: `${file.name} can't be used: ${stored.error.message}` });
      if (stored.value.sha256 !== asset.visual.sha256) {
        // Never a silent replacement: a different file is a new version, reviewed on its own.
        return setRebuild({
          busy: false,
          message: `${file.name} is a different file (sha256 ${stored.value.sha256.slice(0, 12)}…, not ${asset.visual.sha256.slice(0, 12)}…), so it was not used here. To use it, choose it with Change look… as a new reviewed version.`,
        });
      }
      setRebuild({ busy: false, message: `Restored ${asset.name}: the same file (its hash matches).` });
      retry();
    },
    [retry],
  );
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

  // On the simple screen the drawing panel is a column of its own beside the 3D view, so it
  // never covers the scene; with Details on it floats over the view as before.
  const docked = view !== "chat" && !details && project !== null && sourceDrawing !== null && mode !== "walk" && drawingPanel.open;
  const guidedFor = guidedState?.loadId === loadId ? guidedState : null;
  const guidedDraft = guidedFor?.draft ?? (project?.process ? guidedFrom(project.process) : emptyGuided());
  const guidedNode =
    project && sourceDrawing && (!project.process || guidedFor?.open) ? (
      <GuidedSetup
        project={project}
        selected={selected}
        client={client}
        suggestions={assistOn}
        draft={guidedDraft}
        onDraft={(draft) => setGuidedState({ loadId, draft, open: guidedFor?.open ?? false })}
        onSave={(process, summary) => {
          const outcome = run({ baseRevision: project.scene.revision, command: { type: "set_process", process, summary } });
          if (!outcome) return "The scene is not editable right now.";
          if (!outcome.ok && outcome.rejection.kind !== "no_change") return outcome.rejection.message;
          setGuidedState({ loadId, draft: guidedDraft, open: false });
          runOn(outcome.ok ? outcome.state.project : project);
          return null;
        }}
        onFullForm={(process) => {
          setSetupFrom(process);
          setSetupDay(true);
        }}
        onCancel={project.process ? () => setGuidedState({ loadId, draft: guidedDraft, open: false }) : null}
      />
    ) : null;
  const runPanel = project ? (
    <RunPanel
      project={project}
      day={activeDay}
      playback={playback}
      stale={dayStale}
      edited={layoutEdited}
      comparison={dayComparison && dayComparison.key === runKey ? dayComparison : null}
      onRun={startRun}
      onCompare={compareDay}
      guided={guidedNode}
      onChangeSetup={() => setGuidedState({ loadId, draft: project.process ? guidedFrom(project.process) : emptyGuided(), open: true })}
      top={bundleNode ?? exampleNode}
      onExport={exportRuns ? () => setExporting(true) : null}
    />
  ) : null;
  // ── The conversation (UX-03) ─────────────────────────────────────────────────────────────
  // Whether the current run's output differs from the drawing's own layout (for the suggestion's
  // wording only; the explanation itself always comes from the comparison).
  const outputChanged = useMemo(() => {
    if (!project?.process || !activeDay?.result || dayStale || !layoutEdited) return null;
    const original = runOriginal(project, project.process);
    return original?.result ? original.result.metrics.completed !== activeDay.result.metrics.completed : null;
  }, [activeDay, dayStale, layoutEdited, project]);
  const assistMode: "live" | "recorded" | "off" | "checking" | "unreachable" =
    assist.status === "known" ? (assist.assist.available ? assist.assist.mode : "off") : assist.status === "checking" ? "checking" : "unreachable";
  const facts: WorldFacts = {
    hasWorld: project !== null && project.scene.objects.length > 0,
    hasDrawing: sourceDrawing !== null,
    reviewOpen,
    hasProcess: project?.process != null,
    hasRun: activeDay?.result != null,
    runStale: dayStale,
    layoutEdited,
    canUndo: session.undoLabel !== null,
    hasSelection: selected !== null && selected.kind === "equipment",
    canExplain: activeDay?.result != null && !dayStale && layoutEdited && project?.process != null,
    outputChanged,
    canImproveLook: project !== null && sourceDrawing !== null && equipmentToImprove(project).length > 0,
  };
  const chat = useChat();
  // The conversation acts on the world as it is after this render.
  useLayoutEffect(() => {
    chat.controller.setHost({
      client,
      project,
      loadId,
      source: sourceDrawing,
      selectedId: selected?.id ?? null,
      assist: { available: assistOn, mode: assistMode, note: assistNote, deadlineS: assist.status === "known" ? (assist.assist.chat_deadline_s ?? null) : null },
      facts,
      routeAsk,
      day: activeDay,
      isSample,
      undoLabel: session.undoLabel,
      fileError: fileCheck.status === "rejected" ? fileCheck.error.message : null,
      loadSample: () => session.loadFixture("sample"),
      openFile: (file) => openAny(file),
      createWorld: (created, filename) => {
        setTool("select");
        if (mode === "walk") setMode("orbit");
        setReviewFocus(null);
        session.loadCreated(created, filename, "drawing");
      },
      pictureImport: (file) => {
        setPictureFile(file);
        setDrawingImport(true);
      },
      select: (id) => select(id),
      execute: (request) => run(request),
      undo: () => {
        const outcome = session.undo();
        if (outcome?.ok) setPlacement(null);
        return outcome;
      },
      setRouteAsk: (ask) => setRouteAsk(ask),
      setPreview: (preview) => setChatPreview(preview ? { loadId, preview } : null),
      runDay: (target) => {
        const on = target ?? project;
        return on ? runOn(on) : null;
      },
      compare: () => compareDay(),
      openSetup: () => setChatSetup(loadId),
      save: () => save(),
      exportRun: () => {
        if (!exportRuns) return false;
        setExporting(true);
        return true;
      },
      openSheet: (sheetView) => {
        if (mode === "walk") setMode("orbit");
        setSheet({ loadId, trace: false });
        setDrawingPanel({ open: true, view: sheetView });
      },
      pickFile: () => chatFile.current?.click(),
      previewUndo: () => session.previewUndo(),
      library: () => {
        // The catalogs the app ships with (the fixtures'), fetched once, after this project's own.
        libraryCache.current ??= Promise.all((["foundation", "industrial-demo"] as const).map((name) => client.getFixture(name))).then((all) => all.flatMap((r) => (r.ok ? r.value.catalog : [])));
        const own = project?.catalog ?? [];
        return libraryCache.current.then((shipped) => [...own, ...shipped]);
      },
      focusObject: (objectId) => {
        if (selectedId === objectId) return issue("frame-selection");
        frameAfter.current = objectId;
        select(objectId);
      },
      pickModelFile: (objectId) => {
        modelTarget.current = objectId;
        modelFile.current?.click();
      },
      setLookPreview: (p) => setLookPreview(p && project ? { loadId, revision: project.scene.revision, ...p } : null),
      openLookCreate: (objectId, kind, initial, done) => setLookCreate({ objectId, kind, initial, done }),
      openPhotoLook: (objectId, file) => setPhotoLook({ objectId, file }),
      openCreate: (kind, description) => {
        const sizes = /(?:,\s*)?([\d.]+) m wide|([\d.]+) m deep|([\d.]+) m high/g;
        let width: number | null = null;
        let depth: number | null = null;
        let height: number | null = null;
        for (const m of description.matchAll(sizes)) {
          if (m[1]) width = Number(m[1]);
          if (m[2]) depth = Number(m[2]);
          if (m[3]) height = Number(m[3]);
        }
        const name = description.split(",")[0]!.trim();
        setCreateInitial({ text: description, name: name.charAt(0).toUpperCase() + name.slice(1), size: { width, depth, height } });
        setCreate(kind);
      },
    });
  });
  // What the conversation points at belongs to the layout it was made for: a change (an applied
  // step, an undo, an edit in the editor) clears it, so no stale route or ghost stays drawn.
  const revision = project?.scene.revision;
  const [previewRevision, setPreviewRevision] = useState(revision);
  if (previewRevision !== revision) {
    setPreviewRevision(revision);
    setChatPreview(null);
  }
  const preview = chatPreview?.loadId === loadId ? chatPreview.preview : null;
  const accent: AccentSpec | null = useMemo(() => {
    if (!preview || !project) return null;
    const objectOf = (id: string) => project.scene.objects.find((o) => o.id === id);
    const outlines = preview.candidates.flatMap((id) => {
      const o = objectOf(id);
      return o ? [{ points: footprint(o), top: o.transform.position_m.y + o.dimensions.height.value_m }] : [];
    });
    return outlines.length || preview.ghosts.length ? { outlines, ghosts: preview.ghosts } : null;
  }, [preview, project]);
  const chatView = view === "chat";
  const sheetOpen = chatView && sheet?.loadId === loadId && drawingPanel.open;
  // The review card stays while the review is open, and while layers that look like drawing
  // symbols are unanswered (they decide whether routes past them can be checked).
  const symbolsPending = sourceDrawing !== null && symbolsAnswered !== loadId && symbolCandidates(sourceDrawing).some((c) => c.likely);
  const chatReview =
    chatView && project && sourceDrawing && (reviewOpen || symbolsPending)
      ? { source: sourceDrawing, onCorrect: applyReview, onCorrectAll: (corrections: ReviewCorrection[]) => {
            // Several corrections in a row: each against the revision the previous one made.
            let revision = project.scene.revision;
            for (const correction of corrections) {
              const outcome = run({ baseRevision: revision, command: { type: "review_drawing", sourceId: sourceDrawing.id, correction } });
              if (!outcome) return "The scene is not editable right now.";
              if (!outcome.ok) { if (outcome.rejection.kind === "no_change") continue; return outcome.rejection.message; } // prettier-ignore
              revision = outcome.state.project.scene.revision;
            }
            return null;
          }, onSymbolsDone: () => setSymbolsAnswered(loadId), onPlan: (trace: boolean) => { if (mode === "walk") setMode("orbit"); setSheet({ loadId, trace }); setDrawingPanel({ open: true, view: "review" }); } } // prettier-ignore
      : null;
  // A floor traced from the conversation closes the plan it opened.
  if (sheet?.trace && sheet.loadId === loadId && sourceDrawing && sourceDrawing.drawing.review.floor.status !== "proposed") setSheet(null);
  /** A file offered by drop, the start screen or the paperclip: the conversation reads it (chat
   * view); the editor opens its usual import or file check. A DWG gets the export it needs. */
  const offerFile = (file: File) => {
    setStartRefused(/\.dwg$/i.test(file.name) ? DWG_MESSAGE : null);
    if (chatView) return void chat.controller.attach(file);
    if (/\.(json|zip)$/i.test(file.name)) return openAny(file);
    setPictureFile(file);
    setDrawingImport(true);
  };
  const help = MODES.find((m) => m.id === mode)!.help;
  const hint = mode !== "walk" && tool !== "select" ? (selected ? TOOL_HELP[tool](snapOn) : TOOL_FIRST[tool]) : help;

  return (
    <div className={chatView ? `app chat-view${chatCollapsed ? " chat-collapsed" : ""}` : `app${details ? "" : " simple"}${docked ? " docked" : ""}`} data-view={view}>
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
        onOpenFile={openAny}
        onLoadFixture={session.loadFixture}
        onStart={() => setStart(true)}
        details={details}
        onDetails={() => setDetails(!details)}
        onAbout={PUBLIC_PREVIEW ? () => setAbout(true) : undefined}
        view={view}
        onView={(next) => {
          setView(next);
          setSheet(null);
          if (next === "editor") setChatPreview(null);
        }}
      />
      {!chatView && (
      <aside className="panel panel-left">
        <JourneyPanel
          stage={journeyStage}
          hasDrawing={sourceDrawing !== null}
          reviewOpen={reviewOpen}
          disabled={prompt !== null || dragging}
          onUpload={() => {
            if (mode === "walk") setMode("orbit");
            setDrawingImport(true);
          }}
          onChange={() => {
            if (mode === "walk") setMode("orbit");
            setTool("move");
          }}
          onCompare={() => {
            if (sourceDrawing) setDrawingPanel({ open: true, view: "compare" });
            else setMode("walk");
          }}
          onCheck={() => {
            if (mode === "walk") setMode("orbit");
            setDrawingPanel({ open: true, view: "check" });
          }}
          onRun={startRun}
        />
        {isSample && !guideClosed && (
          <SampleGuide
            route={checks?.now.route?.outcome ?? null}
            drawn={checks?.drawn.route?.outcome ?? null}
            machineMoved={sampleMoved}
            onMoveForMe={() => moveForMe()}
            onShowCheck={() => setDrawingPanel({ open: true, view: "check" })}
            onUpload={() => {
              if (mode === "walk") setMode("orbit");
              setDrawingImport(true);
            }}
            onClose={() => setGuideClosed(true)}
          />
        )}
        {!details && (
          <SelectionCard
            project={project}
            selected={selected}
            onCheck={() => setDrawingPanel({ open: true, view: "review" })}
            tool={tool}
            onTool={(next) => {
              if (mode === "walk") setMode("orbit");
              setTool(next);
            }}
            onDetails={() => setDetails(true)}
          />
        )}
        {details && <ObjectList project={project} selectedId={selected?.id ?? null} onSelect={select} />}
        {details && project && (
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
      )}
      <main
        ref={viewport}
        className="viewport"
        aria-label="3D scene"
        data-testid="viewport"
        data-renderer={project && rendererReady ? "ready" : "pending"}
        data-camera-mode={mode}
        data-models={`${summary.ready}/${summary.total} ready, ${summary.failed} failed`}
        data-dragging={dragging ? "true" : "false"}
        data-selected={selected?.id ?? ""}
        data-appearance={runShownNow && seeThrough ? "see-through" : appearance}
        data-revision={project?.scene.revision ?? ""}
        data-ghosts={chatView ? (accent?.ghosts.length ?? 0) : 0}
        onPointerDown={() => cameraTouched !== loadId && setCameraTouched(loadId)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          if (!dropActive) setDropActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDropActive(false);
        }}
        onDrop={(e) => {
          const file = e.dataTransfer.files[0];
          if (!file) return;
          e.preventDefault();
          setDropActive(false);
          offerFile(file);
        }}
        onWheel={() => cameraTouched !== loadId && setCameraTouched(loadId)}
      >
        {project && (
          <SceneViewport
            project={shown ?? project}
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
            underlay={underlayShown ? underlay : null}
            picture={underlayShown ? picture : null}
            checks={(chatView ? preview?.route : null) ?? highlights}
            run={runShownNow}
            runLabels={runLabels}
            accent={chatView ? accent : null}
            appearance={runShownNow && seeThrough ? "see-through" : appearance}
          />
        )}
        <div className="viewport-overlays">
          {project?.fixture && <FixtureBanner fixture={project.fixture} edited={project.scene.edit_log.length > 0} />}
          {ghost && editable && <PlacementBanner label={ghost.label} onCancel={() => setPlacement(null)} />}
          {rejection && <EditRejectedNotice message={rejection} onDismiss={() => setRejection(null)} />}
          {project && (
            <ModelNotice
              // Only models some object is drawn with: an unused one (its objects back on their
              // stand-in) is not a problem to report.
              catalog={project.catalog.filter((a) => project.scene.objects.some((o) => o.asset_id === a.id))}
              models={models}
              onRetry={retry}
              onRebuild={() => void rebuildModels()}
              rebuild={rebuild}
              onAttachSame={(asset) => {
                sameTarget.current = asset;
                sameFile.current?.click();
              }}
              onStandIn={(asset) => {
                // Placeholder recovery: the objects drawn with it get their stand-in back (undoable).
                const changes = project.scene.objects.filter((o) => o.asset_id === asset.id).map((o) => ({ objectId: o.id, assetId: null, expected: asset.id }));
                if (changes.length) runAndReport({ baseRevision: project.scene.revision, command: { type: "set_appearance", changes, assets: [] } });
              }}
            />
          )}
          {project && missingRefs.length > 0 && (
            <ReferenceNotice
              sources={missingRefs}
              project={project}
              message={refNotice}
              onAttach={(source) => {
                refTarget.current = source;
                refFile.current?.click();
              }}
            />
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
          {chatView && project && selected && (
            <SelectionChip
              project={project}
              object={selected}
              onEvidence={() => {
                setDetails(true);
                setView("editor");
              }}
              // An object's look, however the world was made (UX-05, ENR-01): the same review
              // card, no AI needed.
              onLook={canChangeLook(selected) ? () => void chat.controller.startLook([selected.id]) : null}
              reference={selectedReference}
              onReference={() => setPhotoLook({ objectId: selected.id, file: null })}
            />
          )}
          {chatView && project && project.scene.objects.length === 0 && scene.status === "loaded" && (
            <EmptyStart dragging={dropActive} refused={startRefused} onUpload={() => chatFile.current?.click()} onExample={() => chat.controller.suggest("example")} />
          )}
          {dropActive && !(chatView && project?.scene.objects.length === 0) && (
            <div className="drop-veil" data-testid="drop-veil">
              Drop to open this file
            </div>
          )}
          {project && project.scene.objects.some((o) => o.kind !== "walkway" && o.kind !== "keep_clear" && heightAssumed(o)) && (
            <div className="appearance-chip" data-testid="appearance-chip">
              <span>{appearance === "draft" ? "Draft appearance · some heights assumed" : "Uncertainty view · see-through heights are assumed"}</span>
              <button type="button" className="link-button" data-testid="appearance-toggle" aria-pressed={appearance === "uncertainty"} onClick={() => setAppearance(appearance === "draft" ? "uncertainty" : "draft")}>
                {appearance === "draft" ? "Show uncertainty" : "Back to draft"}
              </button>
            </div>
          )}
        {project && (!chatView || project.scene.objects.length > 0) && (
          <ViewToolbar
            mode={mode}
            hasSelection={selected !== null}
            onMode={setMode}
            onFrameSelection={() => issue("frame-selection")}
            onFrameAll={() => issue(mode === "walk" ? "reset-walk" : "frame-all")}
          />
        )}
        {project && mode === "top" && <PlanOverlay pixelsPerMetre={pixelsPerMetre} />}
        {runFrame && <RunLabels frame={runFrame} layer={runLabels} selectedId={selected?.id ?? null} />}
        {runShown && activeDay && dayStale && (
          <div className="notice run-stale-notice" data-testid="run-stale-notice">
            The layout changed since this run.{" "}
            <button type="button" className="link-button" data-testid="run-again-bar" onClick={startRun}>
              Run the same shift again
            </button>
          </div>
        )}
        {runShownNow && project?.process && activeDay && (
          <RunBar
            playback={playback}
            replay={runShownNow.replay}
            startClockS={project.process.shift.start_clock_s.value}
            itemName={project.process.item_name}
            breaks={activeDay.plan.input?.breaks ?? []}
            example={project.process.example_note !== null}
            wholeShift={activeDay.result?.metrics.completed ?? 0}
            fingerprint={activeDay.result?.fingerprint ?? ""}
            seeThrough={seeThrough}
            onSeeThrough={setSeeThrough}
            onOverview={() => {
              // The process's stations from high above, to watch the whole flow.
              const ids = new Set(project.process?.stations.map((st) => st.object_id));
              const stations = project.scene.objects.filter((o) => ids.has(o.id));
              const el = viewport.current;
              if (!stations.length || !el) return;
              const box = sceneBounds(stations).expandByScalar(1.5);
              const pose = frameBox(box, 45, el.clientWidth / Math.max(el.clientHeight, 1), [0.25, 1.35, 0.55], 0.95);
              showView({ position: pose.position, target: pose.target, fovDeg: 45 });
            }}
            onDetails={() => {
              if (mode === "walk") setMode("orbit");
              setDrawingPanel({ open: true, view: "run" });
            }}
            onClose={() => {
              playback.pause();
              setRunShown(false);
            }}
          />
        )}
        {project && mode === "walk" && <WalkHud onReset={() => issue("reset-walk")} onExit={() => setMode("orbit")} />}
        {project && sourceDrawing && mode !== "walk" && !docked && (!chatView || sheetOpen) && (
          <SourceDrawing
            project={project}
            selectedId={selected?.id ?? null}
            view={drawingPanel.view}
            open={drawingPanel.open}
            underlay={underlayShown}
            onView={(view) => setDrawingPanel({ open: true, view })}
            onOpen={(open) => setDrawingPanel((p) => ({ ...p, open }))}
            onUnderlay={setUnderlayShown}
            onSelect={select}
            onWalk={() => setMode("walk")}
            missingFiles={source?.kind === "file" ? source.report.missing_source_files : []}
            focus={selected ? null : focusedDrawn}
            onReview={applyReview}
            onDrawn={pickDrawn}
            checks={checks}
            routeAsk={routeAsk}
            onRouteAsk={setRouteAsk}
            run={runPanel}
            reviewStart={chatView && sheet?.trace ? "trace_floor" : null}
          />
        )}
        {project && <SourcePhoto key={`photo-${loadId}`} client={client} project={project} selectedId={selected?.id ?? null} onSelect={select} onView={showView} missingFiles={source?.kind === "file" ? source.report.missing_source_files : []} />}
        {!chatView && details && project && mode !== "walk" && !activePlacement && (
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
        {project && mode !== "walk" && !chatView && (
          <p className="viewport-hint" data-testid="viewport-hint">
            {hint} · <kbd>F</kbd> frame selection · <kbd>H</kbd> frame all
          </p>
        )}
      </main>
      {docked && project && (
        <aside className="panel panel-right panel-drawing" aria-label="Drawing panel">
          <SourceDrawing
            project={project}
            selectedId={selected?.id ?? null}
            view={drawingPanel.view}
            open={drawingPanel.open}
            underlay={underlayShown}
            onView={(view) => setDrawingPanel({ open: true, view })}
            onOpen={(open) => setDrawingPanel((p) => ({ ...p, open }))}
            onUnderlay={setUnderlayShown}
            onSelect={select}
            onWalk={() => setMode("walk")}
            missingFiles={source?.kind === "file" ? source.report.missing_source_files : []}
            focus={selected ? null : focusedDrawn}
            onReview={applyReview}
            onDrawn={pickDrawn}
            checks={checks}
            routeAsk={routeAsk}
            onRouteAsk={setRouteAsk}
            run={runPanel}
          />
        </aside>
      )}
      {!chatView && details && (
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
          onImprove={() => selected && setImprove(selected.id)}
        />
      </aside>
      )}
      {!chatView && <StatusBar project={project} mode={mode} models={summary} savedAs={session.savedAs} dirty={session.dirty} details={details} />}
      {chatView && (
        <ChatPanel
          project={project}
          entries={chat.entries}
          suggestions={chatSuggestions(facts, isSample)}
          busy={chat.busy}
          assist={{ available: assistOn, mode: assistMode }}
          collapsed={chatCollapsed}
          onCollapse={setChatCollapsed}
          onSend={(text) => void chat.controller.send(text)}
          onSuggest={chat.controller.suggest}
          onAttach={offerFile}
          onMove={chat.controller.submitMove}
          onRoute={chat.controller.submitRoute}
          onHighlight={(ids) => setChatPreview((p) => ({ loadId, preview: { ghosts: p?.loadId === loadId ? p.preview.ghosts : [], route: null, candidates: ids } }))}
          plans={chat.controller}
          looks={chat.controller}
          models={chat.controller}
          review={chatReview}
          setup={chatSetup === loadId && guidedNode ? guidedNode : null}
          fileInput={chatFile}
        />
      )}
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
          onDrawing={() => {
            closeStart();
            setDrawingImport(true);
          }}
          onOpenFile={(file) => {
            closeStart();
            openAny(file);
          }}
          onClose={closeStart}
          preview={PUBLIC_PREVIEW}
          onSample={() => {
            closeStart();
            if (source?.kind !== "fixture" || source.name !== "sample") session.loadFixture("sample");
            else setGuideClosed(false);
          }}
          onFullEditor={() => {
            closeStart();
            setDetails(true);
          }}
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
      {about && <AboutPreview client={client} onClose={() => setAbout(false)} />}
      {drawingImport && !prompt && (
        <DrawingImport
          client={client}
          initialFile={pictureFile}
          onClose={() => {
            setDrawingImport(false);
            setPictureFile(null);
          }}
          onCreated={(created, filename) => {
            setDrawingImport(false);
            setPictureFile(null);
            setTool("select");
            if (mode === "walk") setMode("orbit");
            setDrawingPanel({ open: true, view: "review" });
            setReviewFocus(null);
            session.loadCreated(created, filename, "drawing");
          }}
          proposals={assist.status === "known" && assist.assist.available && assist.assist.vision_model !== null}
          onAttach={
            project && sourceDrawing && !isSample
              ? (attached) => {
                  const outcome = run({ baseRevision: project.scene.revision, command: { type: "attach_source", source: attached } });
                  if (outcome && !outcome.ok) setRejection(outcome.rejection.message);
                  setDrawingImport(false);
                  setDrawingPanel({ open: true, view: "drawing" });
                }
              : undefined
          }
        />
      )}
      {improve && project && !prompt && project.scene.objects.some((o) => o.id === improve && project.catalog.some((a) => a.id === o.asset_id && a.generation)) && (
        <ImproveModel
          client={client}
          assist={assist}
          project={project}
          object={project.scene.objects.find((o) => o.id === improve)!}
          onClose={() => setImprove(null)}
          onApply={(request) => {
            const outcome = run(request);
            if (!outcome) return "The scene is not editable right now.";
            if (!outcome.ok) return outcome.rejection.message;
            setImprove(null);
            return null;
          }}
        />
      )}
      {create && !prompt && (
        <CreateObject
          client={client}
          assist={assist}
          startWith={create}
          initial={createInitial}
          onPlace={startGenerated}
          onClose={() => {
            setCreate(null);
            setCreateInitial(null);
          }}
        />
      )}
      <input
        ref={sameFile}
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        data-testid="model-same-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void attachSame(file);
        }}
      />
      <input
        ref={modelFile}
        type="file"
        accept=".glb,model/gltf-binary"
        hidden
        data-testid="model-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const target = modelTarget.current;
          if (file && target) void chat.controller.attachModel(file, target);
        }}
      />
      <input
        ref={refFile}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        data-testid="reference-same-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const source = refTarget.current;
          if (!file || !source?.sha256 || !source.image) return;
          // The same photo, checked by its hash: a different one is refused and nothing changes.
          void client.uploadPhoto(file, source.filename ?? file.name, source.sha256).then((r) => {
            if (r.ok) {
              setRefNotice(null);
              setRestoredRefs((done) => new Set([...done, source.image!.uri]));
            } else
              setRefNotice(
                r.error.kind === "http" && r.error.status === 409
                  ? `${file.name} is a different photo (its sha256 differs), so it was not used. Attach the original, or keep working without it.`
                  : r.error.message,
              );
          });
        }}
      />
      {photoLook && project && !prompt && project.scene.objects.some((o) => o.id === photoLook.objectId) && (
        <PhotoLook
          key={`${photoLook.objectId}-${loadId}`}
          client={client}
          assist={assist}
          project={project}
          object={project.scene.objects.find((o) => o.id === photoLook.objectId)!}
          initialFile={photoLook.file}
          onClose={() => setPhotoLook(null)}
          onCatalog={() => {
            const objectId = photoLook.objectId;
            setPhotoLook(null);
            void chat.controller.startLook([objectId]);
          }}
          onApply={(request) => {
            const outcome = run(request);
            if (!outcome) return "The scene is not editable right now.";
            if (!outcome.ok) return outcome.rejection.message;
            chat.controller.notePhotoLook(request);
            setPhotoLook(null);
            return null;
          }}
        />
      )}
      {lookCreate && project && !prompt && (
        <CreateObject
          client={client}
          assist={assist}
          startWith={lookCreate.kind}
          initial={lookCreate.initial}
          fitTo={lookCreate.initial.size}
          placeLabel={`Use for ${lookCreate.initial.name}`}
          onPlace={(asset) => {
            // The reviewed model becomes this object's look, as one undoable step: never a new
            // object, and its dimensions, evidence and links stay as they are.
            const { objectId, done } = lookCreate;
            setLookCreate(null);
            const object = project.scene.objects.find((o) => o.id === objectId);
            if (!object) return done({ ok: false, message: "The object is no longer in the world." });
            const outcome = run({ baseRevision: project.scene.revision, command: { type: "set_appearance", changes: [{ objectId, assetId: asset.id, expected: object.asset_id }], assets: [asset] } });
            done(outcome?.ok ? { ok: true, assetName: asset.name } : { ok: false, message: outcome && !outcome.ok ? outcome.rejection.message : "The scene is not editable right now." });
          }}
          onClose={() => {
            lookCreate.done(null);
            setLookCreate(null);
          }}
        />
      )}
      {exporting && project && exportRuns && !prompt && <ExportRun client={client} project={project} runs={exportRuns} onClose={() => setExporting(false)} />}
      {setupDay && project && !prompt && (
        <SetupDay
          project={project}
          initial={setupFrom ?? project.process}
          onClose={() => {
            setSetupDay(false);
            setSetupFrom(null);
          }}
          onSave={(process, summary) => {
            const outcome = run({ baseRevision: project.scene.revision, command: { type: "set_process", process, summary } });
            if (!outcome) return "The scene is not editable right now.";
            if (!outcome.ok && outcome.rejection.kind !== "no_change") return outcome.rejection.message;
            setSetupDay(false);
            setSetupFrom(null);
            setGuidedState({ loadId, draft: guidedDraft, open: false });
            setDrawingPanel({ open: true, view: "run" });
            return null;
          }}
        />
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
