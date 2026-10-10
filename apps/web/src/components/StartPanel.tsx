// The guided entry: three things a first-time user can do, each of which works, plus image
// import shown as upcoming (it is planned as IMG-01, not built). The detailed editor stays one
// click away and is what every choice leads into.
import { type ChangeEvent, useEffect, useRef } from "react";

interface Props {
  /** The API is reachable; opening files needs it. */
  apiOnline: boolean;
  onExplore: () => void;
  onDescribe: () => void;
  onBuild: () => void;
  onOpenFile: (file: File) => void;
  onClose: () => void;
}

export function StartPanel({ apiOnline, onExplore, onDescribe, onBuild, onOpenFile, onClose }: Props) {
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
        <button type="button" className="start-card" data-testid="start-explore" onClick={onExplore} autoFocus>
          <strong>Explore the demo</strong>
          <span>Walk around a small packaging line, select equipment and see where every size comes from.</span>
        </button>
        <button type="button" className="start-card" data-testid="start-describe" onClick={onDescribe}>
          <strong>Describe an object</strong>
          <span>Say what is missing, for example “a guarded conveyor about 2.2 m long with a control screen”. Check the size, then place it.</span>
        </button>
        <button type="button" className="start-card" data-testid="start-open" disabled={!apiOnline} onClick={() => fileInput.current?.click()}>
          <strong>Open a project</strong>
          <span>{apiOnline ? "Continue from a project file you saved earlier (.json)." : "Needs the local API, which is not reachable."}</span>
        </button>
        <div className="start-card start-card-upcoming" aria-disabled="true" data-testid="start-image">
          <strong>
            Start from a photo <span className="badge">Coming next</span>
          </strong>
          <span>Turn one picture into a reviewed, editable scene. Planned (IMG-01); not available yet.</span>
        </div>
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={handleFile} aria-label="Project file to open" data-testid="start-file-input" />
      <div className="modal-actions start-footer">
        <button type="button" className="link-button" data-testid="start-build" onClick={onBuild}>
          Build an object by hand
        </button>
        <button type="button" className="link-button" data-testid="start-editor" onClick={onClose}>
          Go to the full editor
        </button>
      </div>
    </dialog>
  );
}
