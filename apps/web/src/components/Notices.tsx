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
  onDismiss: () => void;
}

export function FileRejectedPanel({ filename, error, sceneKept, onDismiss }: FileRejectedProps) {
  return (
    <div className="notice notice-warning" role="alert" data-testid="file-rejected">
      <h2>{filename} was rejected</h2>
      <p>
        {error.message}
        {sceneKept ? " The current scene is unchanged." : ""}
      </p>
      <IssueList issues={issuesOf(error)} />
      <button type="button" className="button" onClick={onDismiss}>
        Dismiss
      </button>
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
