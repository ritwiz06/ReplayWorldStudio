import { useRef, type ChangeEvent } from "react";
import type { FixtureName } from "../api/client";
import type { HealthState } from "../hooks/useHealth";
import { FIXTURE_LABEL, type FileCheck, type SceneState } from "../hooks/useProject";
import { shortcut } from "../shortcuts";
import { HealthIndicator } from "./HealthIndicator";

interface Props {
  scene: SceneState;
  /** The fixture shown or being loaded; null when a local file is open. */
  fixtureName: FixtureName | null;
  health: HealthState;
  fileCheck: FileCheck;
  dirty: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Undo, redo and save are paused (a handle is held or a dialog is open). */
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onOpenFile: (file: File) => void;
  onLoadFixture: (name: FixtureName) => void;
  /** Show the guided start panel. */
  onStart: () => void;
  /** The advanced panels (object list, catalog, inspector) are shown. */
  details: boolean;
  /** The public preview's "Early preview" label, opening what it does and where files go. */
  onAbout?: (() => void) | undefined;
  /** The chat-first screen or the full editor (UX-03); both keep the same world. */
  view: "chat" | "editor";
  onView: (view: "chat" | "editor") => void;
  onDetails: () => void;
}

const FIXTURES: FixtureName[] = ["industrial-demo", "foundation"];
const SHORT_FIXTURE_LABEL: Record<FixtureName, string> = { "industrial-demo": "Demo", foundation: "Foundation", sample: "Sample", empty: "New" };

function sceneStatus(scene: SceneState): [tone: string, text: string] {
  switch (scene.status) {
    case "loading":
      return ["pending", "Loading scene…"];
    case "error":
      return ["error", "Scene failed to load"];
    case "loaded":
      return ["ok", `${scene.project.scene.objects.length} objects`];
  }
}

export function TopBar({ scene, fixtureName, health, fileCheck, dirty, undoLabel, redoLabel, busy, onUndo, onRedo, onSave, onOpenFile, onLoadFixture, onStart, details, onDetails, onAbout, view, onView }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tone, text] = sceneStatus(scene);
  const checking = fileCheck.status === "checking";
  const loaded = scene.status === "loaded";

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (file) onOpenFile(file);
  }

  return (
    <header className="topbar">
      <div className="brand" title="Replay World Studio">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-text">Replay World Studio</span>
        {onAbout && (
          <button type="button" className="chip chip-preview" data-testid="preview-badge" onClick={onAbout} title="What this preview does, where your files go, and how to give feedback">
            Early preview · about &amp; privacy
          </button>
        )}
      </div>
      <div className="project-name" data-testid="project-name" title={loaded ? scene.project.name : undefined}>
        {loaded ? scene.project.name : "No project loaded"}
      </div>
      <div className="topbar-status">
        <div className={`chip chip-${tone}`} role="status" aria-live="polite" data-testid="scene-status">
          <span className="dot" aria-hidden="true" />
          {checking ? (
            `Checking ${fileCheck.filename}…`
          ) : scene.status === "loaded" ? (
            <>
              {/* Narrow windows keep only the count; the text content stays complete. */}
              <span className="label-long">Scene loaded · </span>
              {text}
            </>
          ) : (
            text
          )}
        </div>
        {loaded && (
          <div
            className={`chip ${dirty ? "chip-pending" : "chip-ok"}`}
            data-testid="save-state"
            title={dirty ? "This revision has not been saved to a file" : "This revision matches the file it was loaded from or saved to"}
          >
            <span className="dot" aria-hidden="true" />
            {dirty ? "Unsaved changes" : "No unsaved changes"}
          </div>
        )}
        <HealthIndicator state={health} />
      </div>
      <div className="topbar-actions">
        {view === "editor" && (
          <button type="button" className="button" onClick={onStart} disabled={busy} data-testid="open-start" title="Explore, describe an object, or open a project">
            Start
          </button>
        )}
        <div className="segmented history-buttons" role="group" aria-label="History">
          <button
            type="button"
            onClick={onUndo}
            disabled={!loaded || busy || undoLabel === null}
            title={undoLabel ? `Undo: ${undoLabel} (${shortcut("Z")})` : "Nothing to undo"}
            data-testid="undo"
            aria-label="Undo"
          >
            ↶<span className="label-medium"> Undo</span>
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!loaded || busy || redoLabel === null}
            title={redoLabel ? `Redo: ${redoLabel} (${shortcut("Z", true)})` : "Nothing to redo"}
            data-testid="redo"
            aria-label="Redo"
          >
            ↷<span className="label-medium"> Redo</span>
          </button>
        </div>
        <button
          type="button"
          className="button"
          onClick={onSave}
          disabled={!loaded || busy}
          title={`Download the project as JSON (${shortcut("S")})`}
          data-testid="save"
          aria-label="Save project"
        >
          Save<span className="label-long"> project</span>
        </button>
        {view === "editor" && (
        <button
          type="button"
          className="button"
          aria-pressed={details}
          onClick={onDetails}
          data-testid="details-toggle"
          title={details ? "Hide the object list, catalog and inspector" : "Show the object list, catalog and the inspector with every value's evidence"}
        >
          Details
        </button>
        )}
        {view === "editor" && details && (
        <div className="segmented scene-picker" role="group" aria-label="Scene">
          {FIXTURES.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={fixtureName === name}
              aria-label={FIXTURE_LABEL[name]}
              title={fixtureName === name ? "Reload this scene from the API" : `Load the ${FIXTURE_LABEL[name].toLowerCase()} from the API`}
              onClick={() => onLoadFixture(name)}
            >
              <span className="label-long">{FIXTURE_LABEL[name]}</span>
              <span className="label-short">{SHORT_FIXTURE_LABEL[name]}</span>
            </button>
          ))}
        </div>
        )}
        <button
          type="button"
          className="button view-toggle"
          data-testid="view-toggle"
          aria-pressed={view === "editor"}
          onClick={() => onView(view === "chat" ? "editor" : "chat")}
          title={view === "chat" ? "Every panel and control: the object list, catalog, inspector, drawing review, checks and run details" : "Back to the world and the conversation"}
        >
          {view === "chat" ? "Full editor" : "Chat view"}
        </button>
        <button
          type="button"
          className={`button${view === "editor" ? " button-primary" : ""}`}
          onClick={() => fileInput.current?.click()}
          disabled={checking}
          title="Open a project JSON file, or an evidence bundle (.zip) exported from a run; it is checked by the API before anything is replaced"
          aria-label="Open project…"
        >
          Open<span className="label-long"> project</span>…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json,.zip,application/zip"
          hidden
          onChange={handleFile}
          aria-label="Project file"
          data-testid="scene-file-input"
        />
      </div>
    </header>
  );
}
