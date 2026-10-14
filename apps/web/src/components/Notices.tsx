import type { ContractIssue } from "@replay-world/contracts";
import type { ApiFailure } from "../api/client";
import type { LoadFailure } from "../hooks/useProject";

const TITLE: Record<LoadFailure["kind"], string> = {
  network: "Can't reach the API",
  http: "The API returned an error",
  parse: "The response was not valid JSON",
  contract: "The data does not match the contract",
  file: "The file could not be used",
};

function IssueList({ issues }: { issues: ContractIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues">
      {issues.slice(0, 12).map((issue, i) => (
        <li key={`${issue.path}-${i}`}>
          <code>{issue.path}</code> {issue.message}
        </li>
      ))}
      {issues.length > 12 && <li className="muted">…and {issues.length - 12} more</li>}
    </ul>
  );
}

function issuesOf(error: LoadFailure): ContractIssue[] {
  return error.kind === "http" || error.kind === "contract" ? error.issues : [];
}

export function LoadErrorPanel({ error, onRetry }: { error: ApiFailure; onRetry: () => void }) {
  return (
    <div className="notice notice-error" role="alert" data-testid="load-error">
      <h2>{TITLE[error.kind]}</h2>
      <p>{error.message}</p>
      {error.kind === "network" && (
        <p className="muted">
          Start it with <code>pnpm dev:api</code> from the repository root, then retry.
        </p>
      )}
      <IssueList issues={issuesOf(error)} />
      <button type="button" className="button button-primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

interface FileRejectedProps {
  filename: string;
  error: LoadFailure;
  sceneKept: boolean;
  /** Generated models are missing but can be rebuilt from the file's own specifications. */
  restorable: boolean;
  restore: { busy: boolean; messages: string[] } | undefined;
  onRestore: () => void;
  /** The file's source photo is missing from this computer. */
  photoMissing: { filename: string; sha256: string; busy: boolean; message: string | null } | undefined;
  onAttachPhoto: (file: File) => void;
  onOpenWithoutPhoto: () => void;
  onDismiss: () => void;
}

export function FileRejectedPanel({ filename, error, sceneKept, restorable, restore, onRestore, photoMissing, onAttachPhoto, onOpenWithoutPhoto, onDismiss }: FileRejectedProps) {
  return (
    <div className="notice notice-warning" role="alert" data-testid="file-rejected">
      <h2>{filename} was rejected</h2>
      <p>
        {error.message}
        {sceneKept ? " The current scene is unchanged." : ""}
      </p>
      <IssueList issues={issuesOf(error)} />
      {restorable && (
        <p className="muted">
          This project uses generated models that are not in this computer&apos;s catalog library. They can be rebuilt from the
          specifications saved in the project; a rebuilt file is used only if its sha256 matches the recorded one.
        </p>
      )}
      {restore && restore.messages.length > 0 && (
        <ul className="issues" data-testid="restore-messages">
          {restore.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {photoMissing && (
        <p className="muted" data-testid="photo-missing">
          Its source photo <strong>{photoMissing.filename}</strong> (sha256 {photoMissing.sha256.slice(0, 12)}…) is not in this computer&apos;s source
          library. Attach the original file - it must be the very same file - or open the project without the photo: its objects and their evidence stay,
          only the photo comparison is unavailable.
        </p>
      )}
      {photoMissing?.message && (
        <p className="status-error" role="alert" data-testid="photo-missing-message">
          {photoMissing.message}
        </p>
      )}
      <div className="modal-actions">
        {photoMissing && (
          <>
            <label className={`button button-primary${photoMissing.busy ? " disabled" : ""}`} data-testid="attach-photo">
              {photoMissing.busy ? "Checking…" : "Attach the original photo…"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={photoMissing.busy}
                data-testid="attach-photo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onAttachPhoto(file);
                }}
              />
            </label>
            <button type="button" className="button" data-testid="open-without-photo" onClick={onOpenWithoutPhoto}>
              Open without the photo
            </button>
          </>
        )}
        {restorable && (
          <button type="button" className="button button-primary" disabled={restore?.busy} data-testid="restore-models" onClick={onRestore}>
            {restore?.busy ? "Rebuilding…" : "Rebuild generated models and open"}
          </button>
        )}
        <button type="button" className="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** A rejected edit (for example a handle drag that raced an undo). The scene is unchanged. */
export function EditRejectedNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="notice notice-warning" role="alert" data-testid="edit-rejected">
      <h2>Edit not applied</h2>
      <p>{message} The scene is unchanged.</p>
      <button type="button" className="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export function PlacementBanner({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="notice placement-banner" role="status" data-testid="placement-banner">
      <p>
        <strong>Placing {label}.</strong> Click the floor to place it, or press <kbd>Enter</kbd> to place it at the marker.{" "}
        <kbd>Esc</kbd> cancels.
      </p>
      <button type="button" className="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
