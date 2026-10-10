import { useRef, type ChangeEvent } from "react";
import type { FixtureName } from "../api/client";
import type { HealthState } from "../hooks/useHealth";
import { FIXTURE_LABEL, type FileCheck, type SceneState } from "../hooks/useScene";
import { HealthIndicator } from "./HealthIndicator";

interface Props {
  scene: SceneState;
  /** The fixture shown or being loaded; null when a local file is open. */
  fixtureName: FixtureName | null;
  health: HealthState;
  fileCheck: FileCheck;
  onOpenFile: (file: File) => void;
  onLoadFixture: (name: FixtureName) => void;
}

const FIXTURES: FixtureName[] = ["industrial-demo", "foundation"];

function sceneStatus(scene: SceneState): [tone: string, text: string] {
  switch (scene.status) {
    case "loading":
      return ["pending", "Loading scene…"];
    case "error":
      return ["error", "Scene failed to load"];
    case "loaded":
      return ["ok", `Scene loaded · ${scene.project.scene.objects.length} objects`];
  }
}

export function TopBar({ scene, fixtureName, health, fileCheck, onOpenFile, onLoadFixture }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tone, text] = sceneStatus(scene);
  const checking = fileCheck.status === "checking";

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (file) onOpenFile(file);
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Replay World Studio
      </div>
      <div className="project-name" data-testid="project-name">
        {scene.status === "loaded" ? scene.project.name : "No project loaded"}
      </div>
      <div className="topbar-status">
        <div className={`chip chip-${tone}`} role="status" aria-live="polite" data-testid="scene-status">
          <span className="dot" aria-hidden="true" />
          {checking ? `Checking ${fileCheck.filename}…` : text}
        </div>
        <HealthIndicator state={health} />
      </div>
      <div className="topbar-actions">
        <div className="segmented scene-picker" role="group" aria-label="Scene">
          {FIXTURES.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={fixtureName === name}
              title={fixtureName === name ? "Reload this scene from the API" : `Load the ${FIXTURE_LABEL[name].toLowerCase()} from the API`}
              onClick={() => onLoadFixture(name)}
            >
              {FIXTURE_LABEL[name]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => fileInput.current?.click()}
          disabled={checking}
        >
          Open scene file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleFile}
          aria-label="Scene file"
          data-testid="scene-file-input"
        />
      </div>
    </header>
  );
}
