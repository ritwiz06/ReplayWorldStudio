// The first screen of an empty world: one clear way in ("Try rearranging a workshop": move a
// workstation, see whether material still reaches every station, and what the example shift
// does), then your own plan or the example factory. A DWG is answered with the export it needs,
// never silently refused.
import { DWG_MESSAGE } from "../drawing/orchestrator";

interface Props {
  dragging: boolean;
  /** Set when the last file offered here was refused (a DWG, say), with the reason. */
  refused: string | null;
  onWorkshop: () => void;
  onUpload: () => void;
  onExample: () => void;
}

export { DWG_MESSAGE };

export function EmptyStart({ dragging, refused, onWorkshop, onUpload, onExample }: Props) {
  return (
    <section className={`empty-start${dragging ? " dragging" : ""}`} aria-label="Start a world" data-testid="empty-start">
      <button type="button" className="empty-task" data-testid="empty-workshop" onClick={onWorkshop}>
        <img src="/workshop-preview.jpg" alt="The example workshop: a material rack, saw bench, assembly bench and packing table on either side of a doorway" width="480" height="270" />
        <span className="empty-task-text">
          <strong>Try rearranging a workshop</strong>
          <span>Can the assembly bench go beside the doorway? See whether material still reaches every station, and what changes in the example shift.</span>
          <span className="button button-primary empty-button">Start</span>
        </span>
      </button>
      <div className="empty-drop" data-testid="empty-drop">
        <h2>Or start from your own plan</h2>
        <p>Drop a plan here: it becomes a 3D world you can change, check and run a shift in. The file stays on this computer.</p>
        <div className="empty-actions">
          <button type="button" className="button empty-button" data-testid="empty-upload" onClick={onUpload}>
            Upload plan
          </button>
          <button type="button" className="button empty-button" data-testid="empty-example" onClick={onExample}>
            Explore the example factory
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
    </section>
  );
}
