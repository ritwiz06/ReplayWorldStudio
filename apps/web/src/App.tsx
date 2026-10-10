import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient } from "./api/client";
import { Inspector } from "./components/Inspector";
import { FileRejectedPanel, LoadErrorPanel } from "./components/Notices";
import { ObjectList } from "./components/ObjectList";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { FixtureBanner, ModelNotice, PlanOverlay, ViewToolbar, WalkHud } from "./components/ViewControls";
import { summarise, useCatalogModels } from "./hooks/useCatalogModels";
import { useHealth } from "./hooks/useHealth";
import { useScene } from "./hooks/useScene";
import type { CameraMode, CameraProbe, ViewCommand } from "./scene/CameraRig";
import { isTyping, MODES } from "./scene/modes";
import { SceneViewport } from "./scene/SceneViewport";

const client = createApiClient();

export function App() {
  const health = useHealth(client);
  const { scene, fixtureName, fileCheck, loadFixture, reloadFixture, openFile, dismissFileCheck } = useScene(client);
  const project = scene.status === "loaded" ? scene.project : null;
  const source = scene.status === "loaded" ? scene.source : null;
  const { models, retry } = useCatalogModels(client, project);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [mode, setMode] = useState<CameraMode>("orbit");
  const [command, setCommand] = useState<ViewCommand | null>(null);
  const [pixelsPerMetre, setPixelsPerMetre] = useState<number | null>(null);
  const viewport = useRef<HTMLElement>(null);

  const selected = project?.scene.objects.find((o) => o.id === selectedId) ?? null;
  const summary = summarise(models);

  const issue = useCallback((type: ViewCommand["type"]) => {
    setCommand((current) => ({ type, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  // Camera state goes straight to a data attribute (for tests and debugging) instead of React
  // state, so the 3D scene does not re-render several times a second. Only the plan scale,
  // which the scale bar needs, is kept in state, and only when it changes noticeably.
  const onProbe = useCallback((probe: CameraProbe) => {
    if (viewport.current) viewport.current.dataset.camera = JSON.stringify(probe);
    const next = probe.pixelsPerMetre;
    if (next !== null) setPixelsPerMetre((prev) => (prev !== null && Math.abs(next - prev) / prev < 0.01 ? prev : next));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const choice = MODES.find((m) => m.key === e.key);
      if (choice) setMode(choice.id);
      else if (e.key === "f" || e.key === "F") {
        if (selected) issue("frame-selection");
      } else if (e.key === "h" || e.key === "H" || e.key === "Home") issue("frame-all");
      else if ((e.key === "r" || e.key === "R") && mode === "walk") issue("reset-walk");
      else if (e.key === "Escape") {
        if (mode === "walk") setMode("orbit");
        else setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issue, mode, selected]);

  const help = MODES.find((m) => m.id === mode)!.help;

  return (
    <div className="app">
      <TopBar
        scene={scene}
        fixtureName={source?.kind === "fixture" || scene.status !== "loaded" ? fixtureName : null}
        health={health}
        fileCheck={fileCheck}
        onOpenFile={(file) => void openFile(file)}
        onLoadFixture={loadFixture}
      />
      <aside className="panel panel-left">
        <ObjectList project={project} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      </aside>
      <main
        ref={viewport}
        className="viewport"
        aria-label="3D scene"
        data-testid="viewport"
        data-renderer={project && rendererReady ? "ready" : "pending"}
        data-camera-mode={mode}
        data-models={`${summary.ready}/${summary.total} ready, ${summary.failed} failed`}
      >
        {project && (
          <SceneViewport
            project={project}
            models={models}
            mode={mode}
            command={command}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onReady={() => setRendererReady(true)}
            onProbe={onProbe}
            planPixelsPerMetre={pixelsPerMetre}
          />
        )}
        <div className="viewport-overlays">
          {project?.fixture && <FixtureBanner fixture={project.fixture} />}
          {project && <ModelNotice catalog={project.catalog} models={models} onRetry={retry} />}
          {scene.status === "loading" && <div className="notice">Loading scene from the API…</div>}
          {scene.status === "error" && <LoadErrorPanel error={scene.error} onRetry={reloadFixture} />}
          {fileCheck.status === "rejected" && (
            <FileRejectedPanel
              filename={fileCheck.filename}
              error={fileCheck.error}
              sceneKept={project !== null}
              onDismiss={dismissFileCheck}
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
        {project && mode !== "walk" && (
          <p className="viewport-hint">
            {help} · <kbd>F</kbd> frame selection · <kbd>H</kbd> frame all
          </p>
        )}
      </main>
      <aside className="panel panel-right">
        <Inspector project={project} source={source} selected={selected} models={models} />
      </aside>
      <StatusBar project={project} mode={mode} models={summary} />
    </div>
  );
}
