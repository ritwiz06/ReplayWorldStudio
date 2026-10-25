// The first screen of an empty world (UX-04): a place to drop a plan, the two ways in (upload
// a plan, explore the example), a small picture of the real example world, and what can be
// read. A DWG is answered with the export it needs, never silently refused.
import { DWG_MESSAGE } from "../drawing/orchestrator";

interface Props {
  dragging: boolean;
  /** Set when the last file offered here was refused (a DWG, say), with the reason. */
  refused: string | null;
  onUpload: () => void;
  onExample: () => void;
}

export { DWG_MESSAGE };

export function EmptyStart({ dragging, refused, onUpload, onExample }: Props) {
  return (
    <section className={`empty-start${dragging ? " dragging" : ""}`} aria-label="Start a world" data-testid="empty-start">
      <div className="empty-drop" data-testid="empty-drop">
        <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
          <path d="M24 31V11m0 0-8 8m8-8 8 8M10 30v6a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3v-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h1>Drop your plan here</h1>
        <p>It becomes a 3D world you can change, check and run a shift in. The file stays on this computer.</p>
        <div className="empty-actions">
          <button type="button" className="button button-primary empty-button" data-testid="empty-upload" onClick={onUpload}>
            Upload plan
          </button>
          <button type="button" className="button empty-button" data-testid="empty-example" onClick={onExample}>
            Explore example
          </button>
        </div>
        <p className="empty-formats" data-testid="empty-formats">
          DXF (ASCII) · PDF page · PNG · JPEG · a saved project (.json) or evidence bundle (.zip). A DWG must be saved as DXF first.
        </p>
        {refused && (
          <p className="empty-refused" role="alert" data-testid="empty-refused">
            {refused}
          </p>
        )}
      </div>
      <button type="button" className="empty-preview" data-testid="empty-preview" onClick={onExample} aria-label="Explore the example factory">
        <img src="/example-preview.jpg" alt="The example factory: two racks, a mixer, Machine B and a packing table in a made-up hall" width="320" height="180" />
        <span>
          <strong>Example factory</strong> · synthetic, with an example shift
        </span>
      </button>
    </section>
  );
}
