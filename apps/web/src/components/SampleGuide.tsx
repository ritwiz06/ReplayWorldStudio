// The sample's one-minute guide (ADR-054): which machine to move, where to look, and what the
// width-only route check now says. It follows the live result, so it is never ahead of the app.
import type { RouteResult } from "../checks/route";

interface Props {
  /** The route answer for the layout now, or null while Check layout is not open. */
  route: RouteResult["outcome"] | null;
  /** The route answer for the drawing's own arrangement. */
  drawn: RouteResult["outcome"] | null;
  machineMoved: boolean;
  onMoveForMe: () => void;
  onShowCheck: () => void;
  onUpload: () => void;
  onClose: () => void;
}

const WORDS = { fits: "clear", conflict: "blocked", cannot_determine: "not determined yet" } as const;

export function SampleGuide({ route, drawn, machineMoved, onMoveForMe, onShowCheck, onUpload, onClose }: Props) {
  const blocked = route === "conflict";
  return (
    <section className="sample-guide" aria-label="Try the sample" data-testid="sample-guide" data-route={route ?? "unknown"}>
      <div className="sample-guide-head">
        <strong>Try it: does the aisle still fit?</strong>
        <button type="button" className="link-button small" onClick={onClose} data-testid="sample-guide-close">
          Close
        </button>
      </div>
      <p className="small muted">A synthetic factory hall drawn as a DXF. The check asks whether a 1.20 m cart, with 0.10 m spare each side, can get along the aisle between the racks.</p>
      {!blocked ? (
        <ol className="small sample-steps">
          <li>
            <strong>Machine B</strong> is selected (top right of the hall). Drag the yellow disc in the 3D view to move it into the aisle between the two long racks, or{" "}
            <button type="button" className="link-button" data-testid="sample-move" onClick={onMoveForMe}>
              move it for me
            </button>
            .
          </li>
          <li>
            Watch <strong>Route A to B</strong> on the right:{" "}
            {route ? (
              <span data-testid="sample-route">
                it is <strong className={`route-${route}`}>{WORDS[route]}</strong>
                {machineMoved && route === "fits" ? " (Machine B is not in the way yet)" : ""}.
              </span>
            ) : (
              <button type="button" className="link-button" onClick={onShowCheck}>
                open Check layout
              </button>
            )}
          </li>
        </ol>
      ) : (
        <div className="small" data-testid="sample-blocked">
          <p>
            <strong className="route-conflict">Blocked.</strong> With Machine B in the aisle, the narrowest gap is too small for the cart. The table on the right compares the drawing ({drawn ? WORDS[drawn] : "?"}) with the layout now.
          </p>
          <p>Press Undo to put it back, try another position, or walk through it. Then try your own plan.</p>
        </div>
      )}
      <p className="small muted">The footprint check also finds the drawing's own problem: the turned mixer overlaps the control panel. Try turning it square.</p>
      <div className="sample-actions">
        <button type="button" className="button button-small button-primary" data-testid="sample-upload" onClick={onUpload}>
          Upload your own plan
        </button>
      </div>
      <p className="small muted">A 2D width check of the reviewed design: turning, heights and the real site are not checked.</p>
    </section>
  );
}
