// "Improve from photo" (ENR-01): a photo of one existing object makes it look more like the
// object. The photo is shown at once and nothing leaves this computer until the person presses
// Suggest appearance; then only the chosen crop (a new JPEG without metadata), the object's
// name, its recorded size and, if it is drawn with a generated model, that model's part list go
// to the vision model. The review shows the photo, the current look and the proposed look; the
// proposal can be changed by hand with GEN-02's controls. Apply builds a new, immutable asset and
// changes only this object's look, through the same undoable command as every other look; the
// recorded size, its evidence and every link stay as they are. Without a vision model, the same
// window is manual work: keep the photo as a reference, build the look by hand, or choose a
// catalog model.
import type { AppearanceProposalResult, GeometryDraft, GeometryPart, ImageBox, LanguageModelRef, Project, ReferenceAssetRequest, SceneObject } from "@replay-world/contracts";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { colourGroups, recolour, removePart, sameSpec, specChanges, withParts } from "../assist/revisionDraft";
import type { CommandRequest, EditCommand } from "../editing/commands";
import { formatFixed } from "../editing/units";
import type { AssistState } from "../hooks/useAssistStatus";
import { analysisCopy, type Photo, readPhoto, WHOLE } from "../photo/image";
import { currentLook, envelopeOf, isWhole, lookName, referenceSourceFor, roundCrop, startFrom } from "../photo/reference";
import { ModelPreview, type Pickable, type PreviewModel, type RevisionView } from "../scene/ModelPreview";
import { PartsEditor } from "./PartsEditor";

interface Props {
  client: ApiClient;
  assist: AssistState;
  project: Project;
  object: SceneObject;
  /** A photo attached in the conversation, shown at once; null to choose one here. */
  initialFile: File | null;
  /** Run the prepared command; returns why it was refused, or null when it applied. */
  onApply: (request: CommandRequest) => string | null;
  /** Choose a catalog model for this object instead (the Change look… list). */
  onCatalog: () => void;
  onClose: () => void;
}

/** What the vision model proposed, kept so the asset records who proposed what. */
interface Proposal {
  result: AppearanceProposalResult;
  languageModel: LanguageModelRef;
  instruction: string | null;
  crop: ImageBox;
  cropPx: { width: number; height: number };
  adjusted: boolean;
}

type Stage =
  | { kind: "choose"; error: string | null }
  | { kind: "photo" }
  | { kind: "asking"; startedAt: number; controller: AbortController }
  | { kind: "review"; manual: boolean }
  | { kind: "applying"; status: string };

type Preview = { status: "building" } | { status: "ready"; model: PreviewModel & { spec?: GeometryDraft } } | { status: "failed"; message: string };

const COLOURS: GeometryPart["material"][] = [
  "paint_light_grey", "paint_white", "paint_anthracite", "paint_blue", "paint_red", "paint_green", "paint_orange", "safety_yellow",
  "aluminium", "stainless_steel", "steel_dark", "plastic_black", "plastic_grey", "glass_clear", "polycarbonate", "wood",
  "fabric_grey", "rubber_black", "hmi_screen", "motor_blue",
];
const VIEW_LABEL: Record<RevisionView, string> = { "front-right": "Standard view", "rear-left": "From behind", "low-front": "Low view" };
const words = (s: string) => s.replaceAll("_", " ");
const m = (v: number) => formatFixed(v, 2);
const ACCEPT = "image/jpeg,image/png,image/webp";

export function PhotoLook({ client, assist, project, object, initialFile, onApply, onCatalog, onClose }: Props) {
  const [baseRevision] = useState(project.scene.revision);
  const [expected] = useState(object.asset_id);
  const look = useMemo(() => currentLook(project, object), [project, object]);
  const start = useMemo(() => startFrom(project, object), [project, object]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [crop, setCrop] = useState<ImageBox>(WHOLE);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<Stage>(initialFile ? { kind: "photo" } : { kind: "choose", error: null });
  const [notice, setNotice] = useState<{ tone: "error" | "warning" | "info"; text: string } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<GeometryDraft>(start.spec);
  const [current, setCurrent] = useState<Preview>({ status: "building" });
  const [proposed, setProposed] = useState<Preview>({ status: "building" });
  const [view, setView] = useState<RevisionView>("front-right");
  const [part, setPart] = useState<string | null>(null);
  const [byHand, setByHand] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const vision = assist.status === "known" && assist.assist.available && assist.assist.vision_model !== null ? assist.assist : null;
  const who = vision ? `${vision.service ?? "the assistant"} (${vision.vision_model})` : null;

  async function choose(file: File) {
    const read = await readPhoto(file);
    if (typeof read === "string") return setStage({ kind: "choose", error: read });
    setPhoto(read);
    setCrop(WHOLE);
    setStage({ kind: "photo" });
  }
  // The photo the window was opened with, read once (its result arrives asynchronously).
  const opened = useRef(false);
  useEffect(() => {
    if (!initialFile || opened.current) return;
    opened.current = true;
    void readPhoto(initialFile).then((read) => {
      if (typeof read === "string") return setStage({ kind: "choose", error: read });
      setPhoto(read);
    });
  }, [initialFile]);

  // The current look, drawn by itself: a generated model or the stand-in block from their
  // specifications, a catalog or attached model from its stored, hash-checked file.
  useEffect(() => {
    const controller = new AbortController();
    const asset = look.kind === "catalog" || look.kind === "uploaded" ? look.asset : null;
    if (asset && asset.visual.type === "gltf") {
      const visual = asset.visual;
      fetch(client.catalogFileUrl(visual.uri), { signal: controller.signal })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(
          (data) => setCurrent({ status: "ready", model: { visual, glb_base64: null, data } }),
          () => !controller.signal.aborted && setCurrent({ status: "failed", message: "The current model file is not available here." }),
        );
    } else {
      const spec = look.kind === "generated" ? look.spec : start.spec;
      client.previewGeneratedModel(spec, controller.signal).then(
        (r) => !controller.signal.aborted && setCurrent(r.ok ? { status: "ready", model: r.value } : { status: "failed", message: r.error.message }),
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [client, look, start]);

  // The proposed look, rebuilt shortly after every change.
  const reviewing = stage.kind === "review" || stage.kind === "applying";
  useEffect(() => {
    if (!reviewing) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setProposed({ status: "building" });
      client.previewGeneratedModel(draft, controller.signal).then(
        (r) => !controller.signal.aborted && setProposed(r.ok ? { status: "ready", model: r.value } : { status: "failed", message: r.error.message }),
        () => undefined,
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, draft, reviewing]);

  const size = `${m(object.dimensions.width.value_m)} × ${m(object.dimensions.depth.value_m)} m, ${m(object.dimensions.height.value_m)} m high`;
  const startsFrom = start.basedOn ? `its current model's part list (${start.spec.parts.length} parts)` : null;

  async function suggest() {
    if (!photo || !vision) return;
    const controller = new AbortController();
    pending.current = controller;
    setNotice(null);
    setStage({ kind: "asking", startedAt: Date.now(), controller });
    const instruction = note.trim().length >= 3 ? note.trim().slice(0, 300) : null;
    let copy;
    let response;
    try {
      copy = await analysisCopy(photo.file, crop);
      if (Math.min(copy.width, copy.height) < 16) throw new Error("small");
      response = await client.proposeAppearance(
        {
          name: object.name.slice(0, 80),
          envelope_m: envelopeOf(object),
          spec: start.basedOn ? (start.spec as AppearanceProposalResult["base"]) : null,
          instruction,
          media_type: "image/jpeg",
          data_base64: copy.data,
          width_px: copy.width,
          height_px: copy.height,
          photo_sha256: photo.sha256,
          crop,
        },
        controller.signal,
      );
    } catch {
      if (controller.signal.aborted) return;
      setStage({ kind: "photo" });
      return setNotice({ tone: "error", text: "The crop is too small or could not be prepared. Choose a larger part of the photo." });
    }
    if (controller.signal.aborted) return; // cancelled: nothing is used
    if (!response.ok) {
      setStage({ kind: "photo" });
      return setNotice({ tone: "error", text: `${response.error.message} Nothing was changed. You can still build the look by hand.` });
    }
    const result = response.value;
    if (result.outcome !== "proposal" || !result.spec) {
      setStage({ kind: "photo" });
      return setNotice({ tone: result.outcome === "already_satisfied" ? "info" : "warning", text: `${result.message ?? "No look was proposed."} Nothing was changed.` });
    }
    setProposal({
      result,
      languageModel: { service: result.provider.service, base_url: result.provider.base_url, model: result.provider.model },
      instruction,
      crop,
      cropPx: { width: copy.width, height: copy.height },
      adjusted: false,
    });
    setDraft(result.spec);
    setView(result.view);
    setByHand([]);
    setStage({ kind: "review", manual: false });
  }

  function cancelAsk() {
    if (stage.kind === "asking") stage.controller.abort();
    setStage({ kind: "photo" });
    setNotice({ tone: "info", text: "Cancelled: nothing was changed, and no answer that arrives later is used." });
  }

  function byHandStart() {
    setProposal(null);
    setDraft(start.spec);
    setByHand([]);
    setView("front-right");
    setStage({ kind: "review", manual: true });
  }

  /** A change by hand: the proposal is marked adjusted, and the change is listed. */
  function edit(next: GeometryDraft, line: string) {
    if (proposal) setProposal({ ...proposal, adjusted: true });
    setByHand((lines) => [...lines, line]);
    setDraft(next);
  }

  const fitted = proposed.status === "ready" ? (proposed.model.spec ?? null) : null;
  const unchanged = fitted !== null && sameSpec(start.spec, fitted);
  const changes = fitted ? specChanges(start.spec, fitted) : [];
  const present = new Set(draft.parts.map((p) => p.id));
  const openProblems = proposal?.result.problems.filter((p) => p.part_ids.some((id) => present.has(id))) ?? [];
  const canApply = stage.kind === "review" && photo !== null && fitted !== null && !unchanged;

  async function keepReference() {
    if (!photo) return;
    setStage({ kind: "applying", status: "Keeping the photo…" });
    const stored = await client.uploadPhoto(photo.file, photo.file.name).catch(() => null);
    if (!stored?.ok) {
      setStage({ kind: "photo" });
      return setNotice({ tone: "error", text: `${stored && !stored.ok ? stored.error.message : "The photo could not be stored."} Nothing was changed.` });
    }
    const source = referenceSourceFor(project, stored.value, object.id, note.trim() ? note.trim().slice(0, 500) : null);
    const refusal = onApply({ baseRevision, command: { type: "attach_reference", source } });
    if (refusal) {
      setStage({ kind: "photo" });
      return setNotice({ tone: "warning", text: refusal });
    }
  }

  async function apply() {
    if (!canApply || !photo || !fitted) return;
    const controller = new AbortController();
    pending.current = controller;
    setStage({ kind: "applying", status: "Keeping the photo…" });
    const fail = (text: string) => {
      setStage({ kind: "review", manual: proposal === null });
      setNotice({ tone: "error", text: `${text} Nothing was changed.` });
    };
    const stored = await client.uploadPhoto(photo.file, photo.file.name, undefined, controller.signal).catch(() => null);
    if (controller.signal.aborted) return;
    if (!stored?.ok) return fail(stored && !stored.ok ? stored.error.message : "The photo could not be stored.");
    const source = referenceSourceFor(project, stored.value, object.id, note.trim() ? note.trim().slice(0, 500) : null);
    const result = proposal?.result ?? null;
    const summary = result
      ? `${result.summary ?? "Made to look like the photo"}${proposal!.adjusted ? " Then adjusted by the person." : ""}`
      : `Built by hand while looking at the reference photo${byHand.length ? `: ${byHand.slice(0, 3).join("; ")}` : ""}`;
    const body: ReferenceAssetRequest = {
      name: `${object.name} (from photo)`.slice(0, 80),
      kind: object.kind === "structure" || object.kind === "reference" ? object.kind : "equipment",
      object_name: object.name,
      spec: fitted,
      summary: summary.slice(0, 500),
      language_model: proposal ? proposal.languageModel : null,
      reference: {
        source_id: source.id,
        photo_sha256: photo.sha256,
        crop: proposal?.crop ?? crop,
        orientation: "exif_applied",
        crop_sha256: result ? result.crop_sha256 : null,
        crop_width_px: proposal ? proposal.cropPx.width : null,
        crop_height_px: proposal ? proposal.cropPx.height : null,
        object_id: object.id,
        instruction: proposal?.instruction ?? null,
        prompt: result ? result.prompt : null,
        based_on: start.basedOn,
        visible: result ? result.visible : [],
        estimated: result ? result.estimated : [],
        adjusted_by_user: proposal ? proposal.adjusted : byHand.length > 0,
      },
      changes: [...changes, ...byHand.map((l) => `By the person: ${l}`), ...openProblems.map((p) => `Problem found in the proposal: ${p.text}`)].slice(0, 40),
      not_represented: result ? result.not_represented : [],
    };
    setStage({ kind: "applying", status: "Building the new look…" });
    const built = await client.referenceAsset(body, controller.signal).catch(() => null);
    if (controller.signal.aborted) return;
    if (!built?.ok) return fail(built && !built.ok ? built.error.message : "The new look could not be built.");
    const command: EditCommand = {
      type: "set_appearance",
      changes: [{ objectId: object.id, assetId: built.value.id, expected, reason: proposal ? `from a reference photo, proposed by ${proposal.languageModel.model} and reviewed` : "from a reference photo, built by hand" }],
      assets: [built.value],
      reference: source,
    };
    const refusal = onApply({ baseRevision, command });
    if (refusal) return fail(`${refusal}`);
  }

  const busy = stage.kind === "asking" || stage.kind === "applying";
  const shown = proposal?.crop ?? crop;
  const pickable: Pickable[] = draft.parts.map((p) => ({ id: p.id, center: [p.center_m.x, p.center_m.y, p.center_m.z], size: [p.size_m.x, p.size_m.y, p.size_m.z] }));
  const highlight = draft.parts.filter((p) => p.id === part).map((p) => ({ center: [p.center_m.x, p.center_m.y, p.center_m.z] as [number, number, number], size: [p.size_m.x, p.size_m.y, p.size_m.z] as [number, number, number] }));
  const chosenPart = draft.parts.find((p) => p.id === part) ?? null;
  const headline = proposal
    ? `${proposal.result.summary ?? "A new look from the photo"}${proposal.adjusted ? " (then changed by you)" : ""}`
    : "Manual work: change the parts and colours below while looking at the photo.";

  return (
    <dialog
      ref={dialog}
      className="modal photo-look"
      aria-labelledby="photo-look-title"
      data-testid="photo-look"
      data-stage={stage.kind}
      onCancel={(e) => {
        // Only the dialog's own Escape: a dismissed file chooser's "cancel" bubbles up to here.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="create-head">
        <h2 id="photo-look-title">Improve from photo</h2>
        <button type="button" className="button" onClick={onClose} disabled={stage.kind === "applying"} data-testid="photo-look-close">
          Close
        </button>
      </div>
      <p className="small" data-testid="photo-look-target">
        For <strong>{object.name}</strong> ({size}, kept as recorded), now drawn with {lookName(look)}. Only its look can change: never its size, place, evidence or links,
        and no new object is added.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="photo-look-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void choose(file);
        }}
      />

      {stage.kind === "choose" && (
        <div className="photo-look-choose">
          <button type="button" className="button button-primary" data-testid="photo-look-pick" onClick={() => fileInput.current?.click()}>
            Choose a photo of {object.name}…
          </button>
          <span className="muted small">JPEG, PNG or WebP. It stays on this computer until you ask for a suggestion.</span>
          {stage.error && (
            <p className="status-error small" role="alert" data-testid="photo-look-error">
              {stage.error}
            </p>
          )}
        </div>
      )}

      {photo && (stage.kind === "photo" || stage.kind === "asking") && (
        <div className="photo-look-crop">
          <CropStage photo={photo} crop={crop} disabled={stage.kind === "asking"} onCrop={setCrop} />
          <div className="photo-look-side">
            <p className="small">
              {isWhole(crop) ? "Drag on the photo to choose only this object, if it shows several." : "Only the outlined part is used."}{" "}
              {!isWhole(crop) && (
                <button type="button" className="link-button" data-testid="photo-look-whole" disabled={stage.kind === "asking"} onClick={() => setCrop(WHOLE)}>
                  Use the whole photo
                </button>
              )}
            </p>
            <label className="photo-field">
              <span>A note for the suggestion (optional)</span>
              <input type="text" maxLength={300} value={note} disabled={stage.kind === "asking"} placeholder="e.g. the front is the side with the screen" data-testid="photo-look-note" onChange={(e) => setNote(e.target.value)} />
            </label>
            {vision ? (
              <p className="muted small" data-testid="photo-look-sends">
                Suggest appearance sends to {who}: this crop as a new JPEG without metadata, the name “{object.name}”, its recorded size
                {startsFrom ? ` and ${startsFrom}` : ""}
                {note.trim() ? " and your note" : ""}. Nothing else from the world. You review the result before anything changes.
              </p>
            ) : (
              <p className="small status-warn" data-testid="photo-look-manual-note">
                AI suggestions are off (no key). This is manual work: keep the photo as a reference, build the look by hand while looking at it, or choose a
                catalog model.
              </p>
            )}
            {stage.kind === "asking" ? (
              <Waiting startedAt={stage.startedAt} who={who ?? "the assistant"} onCancel={cancelAsk} />
            ) : (
              <div className="modal-actions">
                {vision && (
                  <button type="button" className="button button-primary" data-testid="photo-look-suggest" onClick={() => void suggest()}>
                    Suggest appearance
                  </button>
                )}
                <button type="button" className={vision ? "button" : "button button-primary"} data-testid="photo-look-manual" onClick={byHandStart}>
                  Build it by hand
                </button>
                <button type="button" className="button" data-testid="photo-look-catalog" onClick={onCatalog}>
                  Choose a catalog model…
                </button>
                <button type="button" className="button" data-testid="photo-look-keep-reference" onClick={() => void keepReference()}>
                  Keep the photo as a reference only
                </button>
              </div>
            )}
            {notice && (
              <p className={notice.tone === "error" ? "status-error small" : notice.tone === "warning" ? "status-warn small" : "small"} role="alert" data-testid="photo-look-notice">
                {notice.text}
              </p>
            )}
          </div>
        </div>
      )}

      {photo && reviewing && (
        <>
          <p className="photo-look-summary" data-testid="photo-look-summary">
            <strong>{headline}</strong>
            {/recorded size/i.test(headline) ? "" : " Kept the recorded size."}
          </p>
          <div className="photo-look-compare">
            <figure>
              <figcaption>Photo</figcaption>
              <CropView photo={photo} crop={shown} />
            </figure>
            <figure>
              <figcaption>Current: {look.kind === "stand-in" ? "stand-in" : look.asset.name}</figcaption>
              <ModelPreview model={current.status === "ready" ? current.model : null} busy={current.status === "building"} testId="photo-look-current" view={view} />
            </figure>
            <figure>
              <figcaption>Proposed</figcaption>
              <ModelPreview
                model={proposed.status === "ready" ? proposed.model : null}
                busy={proposed.status === "building"}
                testId="photo-look-proposed"
                view={view}
                highlight={highlight}
                pickable={pickable}
                onPick={(id) => setPart(id)}
              />
              {proposed.status === "failed" && (
                <p className="status-error small" role="alert">
                  This look cannot be built: {proposed.message}
                </p>
              )}
            </figure>
          </div>
          <div className="improve-views" role="group" aria-label="Camera for both previews">
            {(Object.keys(VIEW_LABEL) as RevisionView[]).map((v) => (
              <button key={v} type="button" className="button" aria-pressed={view === v} data-testid={`photo-look-view-${v}`} onClick={() => setView(v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          {look.kind === "uploaded" || look.kind === "catalog" ? (
            <p className="muted small" data-testid="photo-look-replaces">
              This is a new, simplified look made of plain shapes; it does not edit {lookName(look)}, which stays in the catalog and comes back with Undo.
            </p>
          ) : null}

          <details className="photo-look-edit" data-testid="photo-look-edit">
            <summary>Change it by hand</summary>
            <div className="photo-look-edit-body">
              <label className="photo-field">
                <span>Part</span>
                <select value={part ?? ""} data-testid="photo-look-part" aria-label="Part to change" onChange={(e) => setPart(e.target.value || null)}>
                  <option value="">Click a part in the proposed look, or choose one…</option>
                  {draft.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({words(p.material)})
                    </option>
                  ))}
                </select>
              </label>
              {chosenPart && draft.parts.length > 1 && (
                <button
                  type="button"
                  className="button"
                  data-testid="photo-look-part-remove"
                  onClick={() => {
                    const action = removePart(draft, chosenPart.id);
                    if (action) edit(action.draft, action.line);
                    setPart(null);
                  }}
                >
                  Remove “{chosenPart.label}”
                </button>
              )}
              <ul className="improve-colours" data-testid="photo-look-colours">
                {colourGroups(draft.parts).map(([material, count]) => (
                  <li key={material}>
                    {words(material)} <span className="muted">({count === 1 ? "1 part" : `${count} parts`})</span>
                    <select
                      aria-label={`Change ${words(material)} to`}
                      value={material}
                      data-testid={`photo-look-colour-${material}`}
                      onChange={(e) => edit(recolour(draft, material, e.target.value as GeometryPart["material"]), `${words(material)} → ${words(e.target.value)}`)}
                    >
                      {COLOURS.includes(material) ? null : <option value={material}>{words(material)}</option>}
                      {COLOURS.map((c) => (
                        <option key={c} value={c}>
                          {words(c)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <details className="improve-parts">
                <summary>The full parts list ({draft.parts.length} parts), for advanced edits</summary>
                <PartsEditor parts={draft.parts} envelope={draft.envelope_m} onParts={(parts) => edit(withParts(draft, parts), "changed the parts list")} />
              </details>
              <p className="muted small">The overall size stays the recorded size; parts are fitted inside it.</p>
            </div>
          </details>

          <details className="photo-look-details" data-testid="photo-look-details">
            <summary>Details</summary>
            <dl className="photo-look-facts small">
              {proposal && (
                <>
                  <dt>Seen in the photo and drawn</dt>
                  <dd>{proposal.result.visible.join("; ") || "—"}</dd>
                  <dt>Estimated, not seen</dt>
                  <dd>{proposal.result.estimated.join("; ") || "—"}</dd>
                  <dt>Seen but not drawable</dt>
                  <dd data-testid="photo-look-unshown">{proposal.result.not_represented.join("; ") || "—"}</dd>
                  <dt>Proposed by</dt>
                  <dd>
                    {proposal.languageModel.service} {proposal.languageModel.model} ({proposal.result.provider.mode === "recorded" ? "recorded answer, offline" : "live"}, {proposal.result.provider.attempts} answer
                    {proposal.result.provider.attempts === 1 ? "" : "s"}, {(proposal.result.provider.latency_ms / 1000).toFixed(1)} s), prompt {proposal.result.prompt}
                  </dd>
                  {proposal.result.adjustments.length > 0 && (
                    <>
                      <dt>Placed or coloured by the app (visual choices, not measurements)</dt>
                      <dd data-testid="photo-look-adjustments">
                        <ul>
                          {proposal.result.adjustments.map((a) => (
                            <li key={a.text}>{a.text}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                  {proposal.result.checks.length > 0 && (
                    <>
                      <dt>What the app checked or fitted</dt>
                      <dd>
                        <ul>
                          {proposal.result.checks.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                </>
              )}
              <dt>Changes from the current look</dt>
              <dd>{unchanged || changes.length === 0 ? "None yet." : changes.join("; ")}</dd>
              <dt>Photo</dt>
              <dd>
                {photo.file.name}, {photo.widthPx} × {photo.heightPx} px, sha256 {photo.sha256.slice(0, 12)}…; crop {Math.round((shown.right - shown.left) * 100)} % × {Math.round((shown.bottom - shown.top) * 100)} %
                (orientation from the file). Kept unchanged with the world when you apply.
              </dd>
              <dt>What it is not</dt>
              <dd>A simplified look made of plain shapes, fitted to the recorded size. Not a measurement, not the manufacturer’s model, and nothing about mass, strength or how it works.</dd>
            </dl>
          </details>

          {openProblems.length > 0 && stage.kind === "review" && (
            <div className="status-warn small improve-apply-problems" data-testid="photo-look-problems">
              <p>
                <strong>{openProblems.length === 1 ? "A problem to know before Apply" : `${openProblems.length} problems to know before Apply`}:</strong>
              </p>
              <ul>
                {openProblems.map((p) => (
                  <li key={p.text}>{p.text}</li>
                ))}
              </ul>
            </div>
          )}
          {proposal && proposal.result.not_represented.length > 0 && stage.kind === "review" && (
            <p className="muted small" data-testid="photo-look-partial">
              Not drawn (the generator cannot show it): {proposal.result.not_represented.slice(0, 3).join("; ")}
              {proposal.result.not_represented.length > 3 ? "; …" : ""}
            </p>
          )}
          {notice && (
            <p className={notice.tone === "error" ? "status-error small" : "status-warn small"} role="alert" data-testid="photo-look-notice">
              {notice.text}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="button button-primary" disabled={!canApply} data-testid="photo-look-apply" onClick={() => void apply()}>
              {stage.kind === "applying" ? stage.status : openProblems.length ? `Apply despite ${openProblems.length === 1 ? "this problem" : "these problems"}` : "Apply to this object"}
            </button>
            <button type="button" className="button" disabled={stage.kind === "applying"} data-testid="photo-look-keep-current" onClick={onClose}>
              Keep the current look
            </button>
            <button
              type="button"
              className="button"
              disabled={stage.kind === "applying"}
              data-testid="photo-look-back"
              onClick={() => {
                setNotice(null);
                setStage({ kind: "photo" });
              }}
            >
              Back to the photo
            </button>
          </div>
          <p className="muted small">One step: Undo returns {object.name} to its current look. The photo is kept with the world, unchanged, as its reference.</p>
        </>
      )}
    </dialog>
  );
}

/** The photo with the chosen part outlined; dragging chooses a new part. */
function CropStage({ photo, crop, disabled, onCrop }: { photo: Photo; crop: ImageBox; disabled: boolean; onCrop: (box: ImageBox) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ u: number; v: number } | null>(null);
  const at = (e: ReactPointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { u: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div
      ref={frame}
      className="photo-look-stage"
      data-testid="photo-look-crop"
      data-crop={`${crop.left},${crop.top},${crop.right},${crop.bottom}`}
      style={{ aspectRatio: `${photo.widthPx} / ${photo.heightPx}`, width: `min(100%, calc(56vh * ${photo.widthPx / photo.heightPx}))` }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e));
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = at(e);
        onCrop(roundCrop({ left: drag.u, top: drag.v, right: p.u, bottom: p.v }));
      }}
      onPointerUp={() => setDrag(null)}
    >
      <img src={photo.url} alt="The reference photo" draggable={false} />
      {!isWhole(crop) && (
        <div
          className="photo-look-box"
          style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${(crop.right - crop.left) * 100}%`, height: `${(crop.bottom - crop.top) * 100}%` }}
        />
      )}
    </div>
  );
}

/** The chosen part of the photo, shown by itself. */
function CropView({ photo, crop }: { photo: Photo; crop: ImageBox }) {
  const w = crop.right - crop.left;
  const h = crop.bottom - crop.top;
  return (
    <div
      className="photo-look-cropview"
      data-testid="photo-look-reference"
      style={{ aspectRatio: `${photo.widthPx * w} / ${photo.heightPx * h}`, width: `min(100%, calc(230px * ${(photo.widthPx * w) / (photo.heightPx * h)}))` }}
    >
      <img src={photo.url} alt="The chosen part of the reference photo" style={{ width: `${100 / w}%`, left: `${(-crop.left / w) * 100}%`, top: `${(-crop.top / h) * 100}%` }} />
    </div>
  );
}

function Waiting({ startedAt, who, onCancel }: { startedAt: number; who: string; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="create-waiting" role="status" data-testid="photo-look-waiting">
      <p>
        <strong>Asking {who}…</strong> {Math.max(0, Math.round((now - startedAt) / 1000))} s (at most 150 s)
      </p>
      <button type="button" className="button" data-testid="photo-look-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
