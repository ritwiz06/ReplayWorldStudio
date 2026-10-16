// "Improve model" (GEN-02): correct the generated model of a placed object and reuse the result.
// The dialog reopens the exact specification the object's asset was built from, lets the user
// change colours, parts and size by hand (no AI needed) or ask the language model for a bounded
// change, and shows the old and new models side by side with the changes in plain words. Nothing
// in the project changes until Apply: the API then builds the revision as a new, immutable
// catalog asset, and one revision-checked command switches the chosen objects to it (undoable).
import type { CatalogAsset, GeneratedAssetRevisionRequest, GeneratedModel, GeometryDraft, GeometryPart, LanguageModelRef, Project, SceneObject } from "@replay-world/contracts";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { ENVELOPE_LIMITS } from "../assist/objectDraft";
import {
  AXIS,
  type ChangedBasis,
  changedSizes,
  colourGroups,
  DIMENSION_KEYS,
  type DimensionKey,
  instancePlan,
  instancesOf,
  recolour,
  revisedDimensions,
  revisedObjects,
  sameSpec,
  specChanges,
  versionOf,
  withParts,
  withSize,
} from "../assist/revisionDraft";
import type { CommandRequest } from "../editing/commands";
import { formatFixed, LENGTH_DECIMALS, parseDecimal } from "../editing/units";
import type { AssistState } from "../hooks/useAssistStatus";
import { ModelPreview } from "../scene/ModelPreview";
import { PartsEditor } from "./PartsEditor";

interface Props {
  client: ApiClient;
  assist: AssistState;
  project: Project;
  object: SceneObject;
  /** Run the prepared command; returns why it was refused, or null when it applied. */
  onApply: (request: CommandRequest) => string | null;
  onClose: () => void;
}

/** What the language model proposed, kept so the revision records who proposed what. */
interface Proposal {
  instruction: string;
  languageModel: LanguageModelRef;
  summary: string | null;
  notRepresented: string[];
  checks: string[];
  /** Added parts the API found a viewer cannot see as asked, not fixed by the model (GEN-05). */
  problems: string[];
  /** The user changed the proposal by hand afterwards. */
  adjusted: boolean;
}

type Preview = { status: "building" } | { status: "ready"; model: GeneratedModel } | { status: "failed"; message: string };

const COLOURS: GeometryPart["material"][] = [
  "paint_light_grey", "paint_white", "paint_anthracite", "paint_blue", "paint_red", "paint_green", "paint_orange", "safety_yellow",
  "aluminium", "stainless_steel", "steel_dark", "plastic_black", "plastic_grey", "glass_clear", "polycarbonate", "wood", "pallet_wood",
  "cardboard", "fabric_grey", "concrete", "copper", "rubber_black", "hmi_screen", "motor_blue",
];
const LABEL: Record<DimensionKey, string> = { width: "Width", height: "Height", depth: "Depth" };
const words = (s: string) => s.replaceAll("_", " ");
const metres = (v: number) => `${formatFixed(v, 3)} m`;

function madeFrom(asset: CatalogAsset): string {
  const g = asset.generation!;
  const lm = g.language_model;
  if (g.method === "photo") return `Seen in a photo${g.description ? ` (${g.description})` : ""}${lm ? `; found by ${lm.model}` : "; marked by the user"}`;
  if (g.method === "described") return `Described by the user: “${g.description}”${lm ? `; drafted by ${lm.model}` : ""}`;
  return "Built by the user in the object builder";
}

export function ImproveModel({ client, assist, project, object, onApply, onClose }: Props) {
  const previous = project.catalog.find((a) => a.id === object.asset_id)!;
  const base = previous.generation!.spec;
  // The scene revision the dialog was opened at: the command is checked against it.
  const [baseRevision] = useState(project.scene.revision);
  const [draft, setDraft] = useState<GeometryDraft>(base);
  const [bases, setBases] = useState<Partial<Record<DimensionKey, ChangedBasis>>>({});
  const [confirmed, setConfirmed] = useState<ReadonlySet<DimensionKey>>(new Set());
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState<{ startedAt: number; controller: AbortController } | null>(null);
  const [askNotice, setAskNotice] = useState<{ tone: "error" | "warning" | "info"; text: string; unshown: string[] } | null>(null);
  const [oldPreview, setOldPreview] = useState<Preview>({ status: "building" });
  const [newPreview, setNewPreview] = useState<Preview>({ status: "building" });
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [adopt, setAdopt] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState<{ busy: boolean; status: string; error: string | null }>({ busy: false, status: "", error: null });
  const pending = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // A modal dialog, above the viewport and its panels.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const available = assist.status === "known" && assist.assist.available;
  const lmName = assist.status === "known" ? `${assist.assist.service ?? "the assistant"} (${assist.assist.model ?? "?"})` : "the assistant";

  // The old model, rebuilt from its recorded specification (the same bytes as the stored file).
  useEffect(() => {
    const controller = new AbortController();
    client.previewGeneratedModel(base, controller.signal).then(
      (r) => {
        if (!controller.signal.aborted) setOldPreview(r.ok ? { status: "ready", model: r.value } : { status: "failed", message: r.error.message });
      },
      () => undefined, // cancelled because the dialog closed
    );
    return () => controller.abort();
  }, [client, base]);

  // The proposed model, rebuilt shortly after every change. The fitted specification it returns
  // is what the change list, the size plan and the revision use.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setNewPreview({ status: "building" });
      client.previewGeneratedModel(draft, controller.signal).then(
        (r) => {
          if (controller.signal.aborted) return;
          setNewPreview(r.ok ? { status: "ready", model: r.value } : { status: "failed", message: r.error.message });
        },
        () => undefined, // superseded by a newer change, or the dialog closed
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, draft]);
  useEffect(() => () => pending.current?.abort(), []);

  const fitted = newPreview.status === "ready" ? newPreview.model.spec : null;
  const changes = fitted ? specChanges(base, fitted) : [];
  const unchanged = fitted !== null && sameSpec(base, fitted);
  const sizesChanged = fitted ? changedSizes(base, fitted) : [];
  const toConfirm = sizesChanged.filter((k) => bases[k] === "proposed" && !confirmed.has(k));
  const objects = instancesOf(project, previous.id, object.id);
  const chosen = scope === "all" ? objects : objects.slice(0, 1);
  const plan = fitted ? instancePlan(chosen, previous, fitted.envelope_m, adopt) : [];
  const canApply = fitted !== null && !unchanged && toConfirm.length === 0 && !applying.busy && !asking;

  /** A change made by hand: changed overall sizes become the user's; a proposal is marked adjusted. */
  function edit(next: GeometryDraft) {
    const moved = DIMENSION_KEYS.filter((k) => next.envelope_m[AXIS[k]] !== draft.envelope_m[AXIS[k]]);
    if (moved.length) setBases((b) => ({ ...b, ...Object.fromEntries(moved.map((k) => [k, "entered"])) }));
    if (proposal) setProposal({ ...proposal, adjusted: true });
    setDraft(next);
  }

  function reset() {
    setDraft(base);
    setBases({});
    setConfirmed(new Set());
    setProposal(null);
    setAskNotice(null);
  }

  async function ask(startedAt: number) {
    const text = instruction.trim();
    if (text.length < 3 || !available) return;
    const controller = new AbortController();
    pending.current = controller;
    setAsking({ startedAt, controller });
    setAskNotice(null);
    let result;
    try {
      result = await client.proposeModelRevision({ name: previous.name.slice(0, 80), spec: base, instruction: text }, controller.signal);
    } catch {
      return; // cancelled: cancelAsk already said so
    }
    if (controller.signal.aborted) return;
    setAsking(null);
    if (!result.ok) return setAskNotice({ tone: "error", text: `${result.error.message} Nothing was changed; the controls below still work.`, unshown: [] });
    const answer = result.value;
    if (answer.outcome === "already_satisfied") {
      // The model already shows it: no identical new version is made.
      return setAskNotice({ tone: "info", text: `Already shown: ${answer.message ?? "the current model already matches this request."} Nothing was changed.`, unshown: answer.not_represented });
    }
    if (answer.outcome !== "proposal" || !answer.spec) {
      return setAskNotice({ tone: "warning", text: `${answer.message ?? "The request could not be turned into a change."} Nothing was changed.`, unshown: answer.not_represented });
    }
    const proposed = answer.spec;
    setDraft(proposed);
    setBases(Object.fromEntries(changedSizes(base, proposed).map((k) => [k, "proposed"])));
    setConfirmed(new Set());
    setProposal({
      instruction: text,
      languageModel: { service: answer.provider.service, base_url: answer.provider.base_url, model: answer.provider.model },
      summary: answer.summary,
      notRepresented: answer.not_represented,
      checks: answer.checks,
      problems: answer.problems,
      adjusted: false,
    });
  }

  function cancelAsk() {
    asking?.controller.abort();
    setAsking(null);
    setAskNotice({ tone: "warning", text: "Cancelled. Nothing was changed.", unshown: [] });
  }

  async function apply() {
    if (!fitted || !canApply) return;
    setApplying({ busy: true, status: "Building the improved model…", error: null });
    const controller = new AbortController();
    pending.current = controller;
    // Problems the checks found stay on the record of the version, so it never reads as fully shown.
    const problems = (proposal?.problems ?? []).map((p) => `Problem found in the proposal: ${p}`);
    const listed = [...(proposal?.adjusted ? [...changes, "Adjusted by the user after the proposal"] : changes), ...problems];
    let built;
    try {
      built = await client.reviseGeneratedAsset(
      {
        previous,
        spec: fitted,
        dimensions: revisedDimensions(base, fitted, bases, confirmed),
        instruction: proposal?.instruction ?? null,
        language_model: proposal?.languageModel ?? null,
        changes: listed.slice(0, 40) as GeneratedAssetRevisionRequest["changes"],
        not_represented: (proposal?.notRepresented.slice(0, 20) ?? []) as GeneratedAssetRevisionRequest["not_represented"],
      },
        controller.signal,
      );
    } catch {
      return; // the dialog closed
    }
    if (controller.signal.aborted) return;
    // A failed build leaves the project exactly as it was.
    if (!built.ok) return setApplying({ busy: false, status: "", error: `${built.error.message} Nothing was changed.` });
    const refusal = onApply({
      baseRevision,
      command: { type: "revise_asset", asset: built.value, previousAssetId: previous.id, objects: revisedObjects(plan, built.value) },
    });
    if (refusal) setApplying({ busy: false, status: "", error: `${refusal} Close this dialog and open it again to start from the current scene.` });
  }

  const colours = colourGroups(draft.parts);

  return (
    <dialog
      ref={dialog}
      className="modal improve-model"
      aria-labelledby="improve-title"
      data-testid="improve-model"
      onCancel={(e) => {
        e.preventDefault();
        if (!applying.busy) onClose();
      }}
    >
      <div className="create-head">
        <h2 id="improve-title">Improve model: {object.name}</h2>
        <button type="button" className="button" onClick={onClose} disabled={applying.busy} data-testid="improve-close">
          Close
        </button>
      </div>
      <p className="muted small" data-testid="improve-origin">
        {previous.name} · version {versionOf(previous)} · {madeFrom(previous)}. The current model and the catalog stay as they are until you apply; the
        improved model becomes a new version and the old one is kept.
      </p>

      <div className="improve-compare">
        <figure>
          <figcaption>Current (version {versionOf(previous)})</figcaption>
          <ModelPreview model={oldPreview.status === "ready" ? oldPreview.model : null} busy={oldPreview.status === "building"} testId="improve-preview-old" />
        </figure>
        <figure>
          <figcaption>Proposed</figcaption>
          <ModelPreview model={newPreview.status === "ready" ? newPreview.model : null} busy={newPreview.status === "building"} testId="improve-preview-new" />
          {newPreview.status === "failed" && (
            <p className="status-error small" role="alert" data-testid="improve-build-error">
              This version cannot be built: {newPreview.message}
            </p>
          )}
        </figure>
      </div>

      <div className="improve-body">
        <section className="improve-controls">
          <h3 className="section-title">Ask for a change</h3>
          <textarea
            value={instruction}
            rows={2}
            maxLength={300}
            placeholder="e.g. make this a bookshelf with open shelves instead of a solid cabinet"
            disabled={!available || asking !== null}
            data-testid="improve-instruction"
            onChange={(e) => setInstruction(e.target.value)}
          />
          {asking ? (
            <AskWaiting startedAt={asking.startedAt} who={lmName} onCancel={cancelAsk} />
          ) : (
            <div className="modal-actions">
              <button type="button" className="button button-primary" disabled={!available || instruction.trim().length < 3} data-testid="improve-propose" onClick={(e) => void ask(e.timeStamp + performance.timeOrigin)}>
                Propose the change
              </button>
              <span className="muted small">
                {available
                  ? `Sends the instruction and this model's part list (no photo, no scene) to ${lmName}. You review the result before anything changes.`
                  : "Proposals are off (no provider configured). Use the controls below."}
              </span>
            </div>
          )}
          {askNotice && (
            <div className={askNotice.tone === "error" ? "status-error small" : askNotice.tone === "info" ? "small" : "status-warn small"} role="alert" data-testid="improve-ask-notice">
              <p>{askNotice.text}</p>
              {askNotice.unshown.length > 0 && <UnshownList items={askNotice.unshown} />}
            </div>
          )}
          {proposal && (
            <div className="improve-proposal" data-testid="improve-proposal">
              <p className="small">
                <strong>Proposed by {proposal.languageModel.model}</strong>
                {proposal.summary ? `: ${proposal.summary}` : ""}
                {proposal.adjusted ? " (then adjusted by you)" : ""}
              </p>
              {proposal.notRepresented.length > 0 && (
                <div className="status-warn small" data-testid="improve-not-represented">
                  <p data-testid="improve-partial">
                    <strong>Partial:</strong> only the part the shape generator can draw is shown below. Not shown, and not imitated:
                  </p>
                  <UnshownList items={proposal.notRepresented} />
                </div>
              )}
              {proposal.problems.length > 0 && (
                <div className="status-warn small" role="alert" data-testid="improve-problems">
                  <p>
                    <strong>Not clearly shown:</strong> these parts are in the proposal, but a viewer may not see them as asked
                    {proposal.adjusted ? " (found before your own changes, which are not checked again)" : ""}:
                  </p>
                  <ul>
                    {proposal.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal.checks.length > 0 && (
                <div className="improve-checks small" data-testid="improve-checks">
                  <p>What the app checked or adjusted:</p>
                  <ul>
                    {proposal.checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <h3 className="section-title">Colours</h3>
          <ul className="improve-colours" data-testid="improve-colours">
            {colours.map(([material, count]) => (
              <li key={material}>
                {words(material)} <span className="muted">({count === 1 ? "1 part" : `${count} parts`})</span>
                <select aria-label={`Change ${words(material)} to`} value={material} data-testid={`improve-colour-${material}`} onChange={(e) => edit(recolour(draft, material, e.target.value as GeometryPart["material"]))}>
                  {COLOURS.includes(material) ? null : <option value={material}>{words(material)}</option>}
                  {COLOURS.map((m) => (
                    <option key={m} value={m}>
                      {words(m)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <h3 className="section-title">Overall size</h3>
          <p className="muted small">Changing a size scales the whole model on that axis. A size you change here is recorded as entered by you; the others keep their evidence.</p>
          {DIMENSION_KEYS.map((key) => (
            <div key={key} className="size-row">
              <span className="size-label">{LABEL[key]}</span>
              <SizeBox value={(fitted ?? draft).envelope_m[AXIS[key]]} testId={`improve-size-${key}`} label={LABEL[key]} onCommit={(v) => edit(withSize(draft, key, v))} />
              <span className="size-tag">
                {!sizesChanged.includes(key) ? `kept (${previous.nominal_dimensions[key].origin.replace("_", " ")})` : bases[key] === "proposed" ? "proposed" : "entered by you"}
              </span>
              {sizesChanged.includes(key) && bases[key] === "proposed" && (
                <label className="small">
                  <input
                    type="checkbox"
                    checked={confirmed.has(key)}
                    data-testid={`improve-confirm-${key}`}
                    onChange={(e) => setConfirmed((c) => (e.target.checked ? new Set([...c, key]) : new Set([...c].filter((k) => k !== key))))}
                  />{" "}
                  confirm {metres(base.envelope_m[AXIS[key]])} → {metres(fitted!.envelope_m[AXIS[key]])}
                </label>
              )}
            </div>
          ))}

          <details className="improve-parts" data-testid="improve-parts">
            <summary>Parts ({draft.parts.length}): change, add or remove</summary>
            <PartsEditor parts={draft.parts} envelope={draft.envelope_m} onParts={(parts) => edit(withParts(draft, parts))} />
          </details>
        </section>

        <section className="improve-review">
          <h3 className="section-title">Changes</h3>
          {unchanged || changes.length === 0 ? (
            <p className="muted small" data-testid="improve-no-changes">
              No changes yet.
            </p>
          ) : (
            <ul className="create-checks" data-testid="improve-changes">
              {changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}

          <h3 className="section-title">Apply to</h3>
          <label className="small">
            <input type="radio" name="improve-scope" checked={scope === "selected"} data-testid="improve-scope-selected" onChange={() => setScope("selected")} /> Only {object.name}
          </label>
          <label className="small">
            <input type="radio" name="improve-scope" checked={scope === "all"} disabled={objects.length < 2} data-testid="improve-scope-all" onChange={() => setScope("all")} /> All {objects.length}{" "}
            objects that use {previous.name}
          </label>
          <ul className="improve-plan" data-testid="improve-plan">
            {plan.map(({ object: o, axes }) => (
              <li key={o.id} data-testid={`improve-plan-${o.id}`}>
                <strong>{o.name}</strong>: switches to the improved model
                {axes.every((a) => a.mode === "same") && "; its size is unchanged"}
                <ul>
                  {axes.map((a) =>
                    a.mode === "follows" ? (
                      <li key={a.key}>
                        {LABEL[a.key]} {metres(a.before)} → {metres(a.after)} (it used the model&apos;s size)
                      </li>
                    ) : a.mode === "own" ? (
                      <li key={a.key}>
                        {LABEL[a.key]}: keeps its own {metres(a.value)} (the model, now {metres(a.modelSize)}, is stretched to it){" "}
                        <label className="small">
                          <input
                            type="checkbox"
                            checked={a.adopt}
                            data-testid={`improve-adopt-${o.id}-${a.key}`}
                            onChange={(e) => {
                              const k = `${o.id}:${a.key}`;
                              setAdopt((s) => (e.target.checked ? new Set([...s, k]) : new Set([...s].filter((x) => x !== k))));
                            }}
                          />{" "}
                          use {metres(a.modelSize)} instead
                        </label>
                      </li>
                    ) : null,
                  )}
                </ul>
              </li>
            ))}
          </ul>
          {toConfirm.length > 0 && (
            <p className="status-warn small" data-testid="improve-needs-confirm">
              Confirm the proposed {toConfirm.map((k) => k).join(" and ")} first.
            </p>
          )}
          {applying.error && (
            <p className="status-error small" role="alert" data-testid="improve-error">
              {applying.error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="button button-primary" disabled={!canApply} data-testid="improve-apply" onClick={() => void apply()}>
              {applying.busy
                ? applying.status
                : `${proposal?.problems.length ? "Apply despite these problems" : proposal?.notRepresented.length ? "Apply the drawable part" : "Apply"} to ${chosen.length === 1 ? "this object" : `${chosen.length} objects`}`}
            </button>
            <button type="button" className="button" disabled={applying.busy || (sameSpec(draft, base) && !proposal)} data-testid="improve-reset" onClick={reset}>
              Start over
            </button>
          </div>
          <p className="muted small">One step: undo returns every object to the previous model and size.</p>
        </section>
      </div>
    </dialog>
  );
}

/** What the request asked for that the model does not show, in the user's words. */
function UnshownList({ items }: { items: readonly string[] }) {
  return (
    <ul className="create-checks" data-testid="improve-unshown">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function AskWaiting({ startedAt, who, onCancel }: { startedAt: number; who: string; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="create-waiting" role="status" data-testid="improve-waiting">
      <p>
        <strong>Asking {who}…</strong> {Math.max(0, Math.round((now - startedAt) / 1000))} s (usually 20–90 s)
      </p>
      <button type="button" className="button" data-testid="improve-cancel-proposal" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function SizeBox({ value, label, testId, onCommit }: { value: number; label: string; testId: string; onCommit: (value: number) => void }) {
  const shown = formatFixed(value, LENGTH_DECIMALS);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    setText(null);
    if (text.trim() === shown) return setError(null);
    const parsed = parseDecimal(text, LENGTH_DECIMALS, "m");
    if (!parsed.ok) return setError(parsed.message);
    if (parsed.value < ENVELOPE_LIMITS.min || parsed.value > ENVELOPE_LIMITS.max) return setError(`Use ${ENVELOPE_LIMITS.min}–${ENVELOPE_LIMITS.max} m.`);
    setError(null);
    onCommit(parsed.value);
  };
  return (
    <span className="size-input">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${label} in metres`}
        data-testid={testId}
        value={text ?? shown}
        onFocus={(e) => {
          setText(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="unit">m</span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}
