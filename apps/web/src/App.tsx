import { useState } from "react";
import { createApiClient } from "./api/client";
import { Inspector } from "./components/Inspector";
import { FileRejectedPanel, FixtureBanner, LoadErrorPanel } from "./components/Notices";
import { ObjectList } from "./components/ObjectList";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useHealth } from "./hooks/useHealth";
import { useScene } from "./hooks/useScene";
import { SceneViewport } from "./scene/SceneViewport";

const client = createApiClient();

export function App() {
  const health = useHealth(client);
  const { scene, fileCheck, reloadFixture, openFile, dismissFileCheck } = useScene(client);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rendererReady, setRendererReady] = useState(false);

  const project = scene.status === "loaded" ? scene.project : null;
  const source = scene.status === "loaded" ? scene.source : null;
  const selected = project?.scene.objects.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="app">
      <TopBar
        scene={scene}
        health={health}
        fileCheck={fileCheck}
        onOpenFile={(file) => void openFile(file)}
        onReloadFixture={reloadFixture}
      />
      <aside className="panel panel-left">
        <ObjectList project={project} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      </aside>
      <main
        className="viewport"
        aria-label="3D scene"
        data-testid="viewport"
        data-renderer={project && rendererReady ? "ready" : "pending"}
      >
        {project && (
          <SceneViewport
            project={project}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onReady={() => setRendererReady(true)}
          />
        )}
        <div className="viewport-overlays">
          {project?.fixture && <FixtureBanner fixture={project.fixture} />}
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
          <p className="viewport-hint">Drag to orbit · scroll to zoom · right-drag to pan · 1 grid cell = 1 m</p>
        )}
      </main>
      <aside className="panel panel-right">
        <Inspector project={project} source={source} selected={selected} />
      </aside>
      <StatusBar project={project} />
    </div>
  );
}
