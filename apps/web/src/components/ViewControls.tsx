import type { CatalogAsset, FixtureLabel } from "@replay-world/contracts";
import { useState } from "react";
import type { ModelStates } from "../hooks/useCatalogModels";
import { scaleBar } from "../scene/cameras";
import type { CameraMode } from "../scene/CameraRig";
import { MODES } from "../scene/modes";
import { EYE_HEIGHT_M } from "../scene/walk";

interface ToolbarProps {
  mode: CameraMode;
  hasSelection: boolean;
  onMode: (mode: CameraMode) => void;
  onFrameSelection: () => void;
  onFrameAll: () => void;
}

export function ViewToolbar({ mode, hasSelection, onMode, onFrameSelection, onFrameAll }: ToolbarProps) {
  return (
    <div className="view-toolbar" role="toolbar" aria-label="Camera">
      <div className="segmented" role="group" aria-label="Camera mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            title={`${m.help} (key ${m.key})`}
            data-testid={`mode-${m.id}`}
            onClick={() => onMode(m.id)}
          >
            {m.label} <kbd>{m.key}</kbd>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button"
        onClick={onFrameSelection}
        disabled={!hasSelection}
        title={hasSelection ? "Frame the selected object (F)" : "Select an object to frame it"}
      >
        {mode === "walk" ? "Go to selection" : "Frame selection"} <kbd>F</kbd>
      </button>
      <button type="button" className="button" onClick={onFrameAll} title="Show the whole area (H)">
        {mode === "walk" ? "Back to start" : "Frame all"} <kbd>H</kbd>
      </button>
    </div>
  );
}

/** Scale bar and plan orientation for the top view. Orientation is the drawing frame, not
 * geographic north, which the project does not record. */
export function PlanOverlay({ pixelsPerMetre }: { pixelsPerMetre: number | null }) {
  const bar = pixelsPerMetre ? scaleBar(pixelsPerMetre) : null;
  return (
    <div className="plan-overlay" data-testid="plan-overlay">
      <div className="plan-orientation" title="Plan orientation: world -Z (plan up) is up the screen, +X is to the right. Not geographic north.">
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
          <circle cx="32" cy="32" r="29" fill="rgba(17,19,22,0.8)" stroke="#5b6470" />
          <path d="M32 8 L39 30 L32 26 L25 30 Z" fill="#7cc4ff" />
          <path d="M32 32 L54 32" stroke="#e5534b" strokeWidth="2.5" />
          <path d="M54 32 L48 28 L48 36 Z" fill="#e5534b" />
        </svg>
        <span>
          <strong>−Z</strong> plan up · <strong>+X</strong> right
        </span>
      </div>
      {bar && (
        <div className="scale-bar" data-testid="scale-bar" aria-label={`Scale bar: ${bar.label}`}>
          <div className="scale-bar-line" style={{ width: `${bar.pixels}px` }} />
          <span>{bar.label}</span>
        </div>
      )}
    </div>
  );
}

export function WalkHud({ onReset, onExit }: { onReset: () => void; onExit: () => void }) {
  return (
    <div className="walk-hud" data-testid="walk-hud" role="region" aria-label="Walk controls">
      <strong>Walk · eye height {EYE_HEIGHT_M.toFixed(2)} m</strong>
      <span>
        <kbd>W</kbd>
        <kbd>A</kbd>
        <kbd>S</kbd>
        <kbd>D</kbd> or arrows move · <kbd>Q</kbd>
        <kbd>E</kbd> turn · drag to look · <kbd>Shift</kbd> faster
      </span>
      <div className="walk-hud-actions">
        <button type="button" className="button" onClick={onReset}>
          Reset position <kbd>R</kbd>
        </button>
        <button type="button" className="button button-primary" onClick={onExit}>
          Exit walk <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}

/** Development data stays labelled as such, including every project edited or saved from it. */
export function FixtureBanner({ fixture, edited }: { fixture: FixtureLabel; edited: boolean }) {
  const [open, setOpen] = useState(false);
  const title = fixture.kind === "demonstration" ? "Synthetic demonstration" : "Foundation fixture";
  return (
    <div className="fixture-banner" role="note" data-testid="fixture-banner">
      <div className="fixture-banner-head">
        <strong>{title}</strong>
        <span>not verified engineering data</span>
        {edited && <span className="banner-edited">Edited layout - still synthetic; only Check layout and Run a day use it</span>}
        <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>
      {open && <p>{fixture.note}</p>}
    </div>
  );
}

interface ModelNoticeProps {
  catalog: readonly CatalogAsset[];
  models: ModelStates;
  onRetry: () => void;
  /** Rebuild failed generated models from their recorded specifications, then retry. */
  onRebuild: () => void;
  rebuild: { busy: boolean; message: string | null };
  /** An attached model (ENR-01) cannot be rebuilt: attach the same file (checked by its hash),
   * or draw its objects with their stand-in again. */
  onAttachSame?: (asset: CatalogAsset) => void;
  onStandIn?: (asset: CatalogAsset) => void;
}

export function ModelNotice({ catalog, models, onRetry, onRebuild, rebuild, onAttachSame, onStandIn }: ModelNoticeProps) {
  const failed = catalog.flatMap((asset) => {
    const state = models.get(asset.id);
    return state?.status === "failed" ? [{ asset, message: state.failure.message }] : [];
  });
  if (failed.length === 0) return null;
  return (
    <div className="notice notice-error" role="alert" data-testid="model-notice">
      <h2>
        {failed.length} of {models.size} equipment models could not be shown
      </h2>
      <ul className="issues">
        {failed.map(({ asset, message }) => (
          <li key={asset.id}>
            <strong>{asset.name}:</strong> {message}
            {asset.upload && (
              <span className="modal-actions">
                {onAttachSame && (
                  <button type="button" className="button button-small button-primary" data-testid={`model-attach-same-${asset.id}`} onClick={() => onAttachSame(asset)}>
                    Attach the same file…
                  </button>
                )}
                {onStandIn && (
                  <button type="button" className="button button-small" data-testid={`model-stand-in-${asset.id}`} onClick={() => onStandIn(asset)}>
                    Use the stand-in
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="muted">
        Affected equipment is drawn as an orange box labelled “Model unavailable” at its recorded size.
      </p>
      {rebuild.message && <p className="muted">{rebuild.message}</p>}
      <div className="modal-actions">
        <button type="button" className="button" onClick={onRetry}>
          Retry models
        </button>
        {failed.some(({ asset }) => asset.generation !== null) && (
          <button type="button" className="button button-primary" disabled={rebuild.busy} data-testid="rebuild-models" onClick={onRebuild}>
            {rebuild.busy ? "Rebuilding…" : "Rebuild generated models"}
          </button>
        )}
      </div>
    </div>
  );
}
