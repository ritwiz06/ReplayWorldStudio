// "About this preview" (ADR-054): what the early preview does and does not do, where uploaded
// files go and how long they stay, the feedback link, and a button to delete one's files now.
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { FEEDBACK_URL, RETENTION_HOURS, SOURCE_URL } from "../config";

interface Props {
  client: ApiClient;
  onClose: () => void;
}

export function AboutPreview({ client, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cleared, setCleared] = useState<"idle" | "busy" | "done" | "failed">("idle");
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  async function clear() {
    setCleared("busy");
    const result = await client.clearVisitorFiles();
    setCleared(result.ok ? "done" : "failed");
  }

  return (
    <dialog
      ref={dialog}
      className="modal about-preview"
      aria-labelledby="about-title"
      data-testid="about-preview"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="create-head">
        <h2 id="about-title">About this early preview</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>
      <p>
        Replay World Studio turns a floor plan into a 3D layout you can walk through, change and check. This is an <strong>early preview</strong>: expect rough edges.
      </p>
      <h3>What it does</h3>
      <ul>
        <li>
          <strong>DXF</strong> (ASCII, up to 10 MB): read into a draft you review: floor, scale, each object.
        </li>
        <li>
          <strong>PDF, PNG or JPEG</strong> (up to 10 MB): shown as a picture; you mark one length you know, then trace the floor and objects yourself.
        </li>
        <li>
          <strong>Check layout</strong>: overlaps, keep-clear zones, and whether an item of a width you enter can get from one point to another. These are 2D checks of
          the reviewed design: turning, heights and the real site are not checked, and outlines you have not traced do not count as exact.
        </li>
        <li>No AI is used in this preview. Nothing becomes an accurate 3D model automatically; heights are assumed for display.</li>
      </ul>
      <h3>Your files</h3>
      <ul data-testid="about-storage">
        <li>Files you upload go to this preview's server, into a folder only your browser can reach (a private cookie, no account). Other visitors cannot read them, even with the file's name.</li>
        <li>
          They are stored on the server temporarily and deleted {RETENTION_HOURS} hours after you first upload them: the server checks every 15 minutes, so
          within 15 minutes after that, and at once when it restarts after being down. Server backups are not enabled for this preview.
        </li>
        <li>
          Your project stays with you: <strong>Save project</strong> downloads it to your computer. Reopen it here any time; if its plan was deleted from the server, the
          layout still opens, and you can upload the plan again.
        </li>
        <li>Upload only plans you are allowed to share with a test service.</li>
      </ul>
      <div className="modal-actions about-actions">
        <button type="button" className="button" data-testid="about-clear" disabled={cleared === "busy"} onClick={() => void clear()}>
          Delete my uploaded files now
        </button>
        {cleared === "done" && (
          <span className="small" role="status" data-testid="about-cleared">
            Deleted. Projects you downloaded are not affected.
          </span>
        )}
        {cleared === "failed" && (
          <span className="small status-error" role="alert">
            They could not be deleted just now; they are deleted after {RETENTION_HOURS} hours anyway.
          </span>
        )}
      </div>
      <h3>Feedback</h3>
      <p>
        Tell us what was confusing or broken on{" "}
        <a href={FEEDBACK_URL} target="_blank" rel="noreferrer" data-testid="about-feedback">
          GitHub Issues
        </a>
        . Issues are public: please do not post private drawings, site names or other details about a real site. The code is at{" "}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          {SOURCE_URL.replace("https://", "")}
        </a>
        .
      </p>
    </dialog>
  );
}
