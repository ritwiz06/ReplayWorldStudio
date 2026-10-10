// Modal decisions. Nothing is replaced or saved until the user picks an action; Esc cancels.
import type { UpgradeReport } from "@replay-world/contracts";
import { type ReactNode, useEffect, useRef } from "react";

function Modal({ labelledBy, testId, onCancel, children }: { labelledBy: string; testId: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={labelledBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {children}
    </dialog>
  );
}

interface UnsavedProps {
  /** What continuing will do, e.g. "load the foundation fixture". */
  action: string;
  revision: number;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ action, revision, onSave, onDiscard, onCancel }: UnsavedProps) {
  return (
    <Modal labelledBy="unsaved-title" testId="unsaved-dialog" onCancel={onCancel}>
      <h2 id="unsaved-title">Unsaved changes</h2>
      <p>
        Scene revision {revision} has not been saved. To {action}, the current project will be replaced, and its unsaved
        edits and undo history would be lost.
      </p>
      <div className="modal-actions">
        <button type="button" className="button button-primary" onClick={onSave} autoFocus>
          Save, then continue
        </button>
        <button type="button" className="button button-danger" onClick={onDiscard}>
          Discard changes
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

interface UpgradeProps {
  filename: string;
  report: UpgradeReport;
  savedAs: string | null;
  onOpen: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function UpgradeReviewDialog({ filename, report, savedAs, onOpen, onSave, onCancel }: UpgradeProps) {
  const { validation } = report;
  return (
    <Modal labelledBy="upgrade-title" testId="upgrade-dialog" onCancel={onCancel}>
      <h2 id="upgrade-title">Review upgrade of {filename}</h2>
      <p>
        This file uses contract <strong>{report.from_version}</strong>. The API upgraded a copy to{" "}
        <strong>{report.to_version}</strong> and validated it ({validation.object_count} objects, {validation.asset_count}{" "}
        catalog assets, {validation.model_file_count} model files verified). The file itself is unchanged, and nothing
        replaces the current scene until you open the upgraded copy.
      </p>
      <h3 className="section-title">Changes made by the upgrade</h3>
      <ol className="upgrade-notes" data-testid="upgrade-notes">
        {report.notes.map((note, i) => (
          <li key={i}>{note}</li>
        ))}
      </ol>
      {savedAs && (
        <p className="muted" role="status">
          Upgraded copy downloaded as <span className="mono">{savedAs}</span>.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="button button-primary" onClick={onOpen} autoFocus>
          Open upgraded project
        </button>
        <button type="button" className="button" onClick={onSave}>
          Download upgraded file
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
