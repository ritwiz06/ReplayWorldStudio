// The guided entry: what a first-time user can do - upload a floor plan (first), explore,
// describe an object, start from a photo, open a project. The detailed editor stays one click away and is what every
// choice leads into.
import { type ChangeEvent, useEffect, useRef } from "react";

interface Props {
  /** The API is reachable; opening files needs it. */
  apiOnline: boolean;
  onExplore: () => void;
  onDescribe: () => void;
  onBuild: () => void;
  onPhoto: () => void;
  onDrawing: () => void;
  onOpenFile: (file: File) => void;
  onClose: () => void;
  /** Close and show the full editor (object list, catalog, inspector). */
  onFullEditor: () => void;
  /** Open the sample factory hall with its guide. */
  onSample: () => void;
  /** The public preview: no AI, so describing objects and photo import are not offered. */
  preview?: boolean | undefined;
}

export function StartPanel({ apiOnline, onExplore, onDescribe, onBuild, onPhoto, onDrawing, onOpenFile, onClose, onFullEditor, onSample, preview }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onOpenFile(file);
  }

  return (
    <dialog
      ref={dialog}
      className="modal start-panel"
      aria-labelledby="start-title"
      data-testid="start-panel"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="start-title">What would you like to do?</h2>
      <p className="muted">Replay World Studio builds editable 3D worlds. Factory layouts are the first example.</p>
      <div className="start-cards">
        <button type="button" className="start-card start-card-main" data-testid="start-drawing" disabled={!apiOnline} onClick={onDrawing} autoFocus>
          <strong>Upload a floor plan</strong>
          <span>
            {apiOnline
              ? "A DXF, or a PDF or picture of the plan: see it at once, walk through a 3D draft, move things and check whether the layout still fits."
              : "Needs the local API, which is not reachable."}
          </span>
        </button>
        <button type="button" className="start-card" data-testid="start-sample" disabled={!apiOnline} onClick={onSample}>
          <strong>Try the sample</strong>
          <span>A synthetic factory hall: move one machine into the aisle and watch the route check go from clear to blocked.</span>
        </button>
        <button type="button" className="start-card" data-testid="start-explore" onClick={onExplore}>
          <strong>Explore the demo</strong>
          <span>Walk around a small packaging line, select equipment and see where every size comes from.</span>
        </button>
        {!preview && (
        <button type="button" className="start-card" data-testid="start-describe" onClick={onDescribe}>
          <strong>Describe an object</strong>
          <span>Say what is missing, for example “a guarded conveyor about 2.2 m long with a control screen”. Check the size, then place it.</span>
        </button>
        )}
        <button type="button" className="start-card" data-testid="start-open" disabled={!apiOnline} onClick={() => fileInput.current?.click()}>
          <strong>Open a project</strong>
          <span>{apiOnline ? "Continue from a project file you saved earlier (.json)." : "Needs the local API, which is not reachable."}</span>
        </button>
        {!preview && (
        <button type="button" className="start-card" data-testid="start-image" disabled={!apiOnline} onClick={onPhoto}>
          <strong>Start from a photo</strong>
          <span>
            {apiOnline
              ? "Turn one photo of a room or work area into an editable 3D world. You check every object and set the scale with a rectangle on the floor."
              : "Needs the local API, which is not reachable."}
          </span>
        </button>
        )}
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json,.zip,application/zip" hidden onChange={handleFile} aria-label="Project file to open" data-testid="start-file-input" />
      <div className="modal-actions start-footer">
        <button type="button" className="link-button" data-testid="start-build" onClick={onBuild}>
          Build an object by hand
        </button>
        <button type="button" className="link-button" data-testid="start-editor" onClick={onFullEditor}>
          Go to the full editor
        </button>
      </div>
    </dialog>
  );
}
