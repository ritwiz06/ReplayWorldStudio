// Start from a photo (IMG-01): one permitted photo of a room or work area becomes a reviewed,
// editable world. The photo is shown at once; nothing leaves this computer until the user
// chooses to analyse it, and then only a smaller copy without metadata goes to the vision
// model. The user reviews every detected object over the photo, marks a floor rectangle of
// known size (the scale), checks the layout from above, and only then creates the world. The
// current project is never touched during analysis or after a failure.
import type { AssistStatus, CatalogAsset, GeometryPart, ImageBox, ImagePoint, ImageProposalResult, LanguageModelRef, Project } from "@replay-world/contracts";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { PHOTO_TEMPLATE_KEY, type PhotoTemplate, TEMPLATES } from "../assist/templates";
import { formatFixed, LENGTH_DECIMALS, parseDecimal } from "../editing/units";
import type { AssistState } from "../hooks/useAssistStatus";
import { type Calibration, calibrateFromRectangle, imagePointOf } from "../photo/floor";
import { type Pixels, suggestAppearance } from "../photo/colour";
import { assetRequest, buildPhotoProject, isPlaced, type PlacedItem, placeItems, type ReviewItem, reviewItemsFrom, type ScaleInput, userItem } from "../photo/world";

const PHOTO_LIMITS = { maxBytes: 15 * 1024 * 1024, maxPixels: 50_000_000, minSide: 64, analysisSide: 1600 } as const;
const ACCEPT = "image/jpeg,image/png,image/webp";

interface Photo {
  file: File;
  url: string;
  widthPx: number;
  heightPx: number;
  sha256: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  /** A small decoded copy, for suggesting each object's colour; null if it could not be made. */
  pixels: Pixels | null;
}

/** Longest side of the decoded copy used for colours. */
const COLOUR_SIDE = 480;

function smallPixels(bitmap: ImageBitmap): Pixels | null {
  const scale = Math.min(1, COLOUR_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const context = Object.assign(document.createElement("canvas"), { width, height }).getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/** Each object's appearance suggested from the photo's pixels inside its outline. */
function withPhotoColours(items: ReviewItem[], pixels: Pixels | null): ReviewItem[] {
  if (!pixels) return items;
  return items.map((item) => {
    const material = suggestAppearance(pixels, item.box);
    if (!material) return item;
    return { ...item, material, notes: material === item.material ? item.notes : [...item.notes, "Colour taken from the photo."] };
  });
}

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "ready"; photo: Photo }
  | { kind: "analysing"; photo: Photo; startedAt: number }
  | { kind: "failed"; photo: Photo; message: string }
  | { kind: "review"; photo: Photo };

interface Props {
  client: ApiClient;
  assist: AssistState;
  onCreated: (project: Project, filename: string) => void;
  onClose: () => void;
}

const TEMPLATE_KEYS = Object.keys(PHOTO_TEMPLATE_KEY) as PhotoTemplate[];
const TEMPLATE_NAME = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, TEMPLATES.find((t) => t.key === PHOTO_TEMPLATE_KEY[k])?.name ?? k])) as Record<PhotoTemplate, string>;
const COLOURS: GeometryPart["material"][] = [
  "paint_light_grey", "paint_white", "paint_anthracite", "plastic_black", "plastic_grey", "fabric_grey", "wood", "pallet_wood",
  "cardboard", "paint_blue", "paint_red", "paint_green", "paint_orange", "safety_yellow", "aluminium", "stainless_steel", "steel_dark", "glass_clear",
];

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sniff(bytes: Uint8Array): Photo["mediaType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const text = String.fromCharCode(...bytes.slice(0, 12));
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Check the file in the browser first (format by content, size, pixels) and show it. */
async function readPhoto(file: File): Promise<Photo | string> {
  if (file.size > PHOTO_LIMITS.maxBytes) return `The photo is ${(file.size / 1048576).toFixed(1)} MB; the limit is 15 MB.`;
  const buffer = await file.arrayBuffer();
  const mediaType = sniff(new Uint8Array(buffer.slice(0, 16)));
  if (!mediaType) return "Only JPEG, PNG and WebP photos are supported.";
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return "The photo could not be read; it may be damaged.";
  }
  const { width, height } = bitmap;
  let pixels: Pixels | null;
  try {
    pixels = smallPixels(bitmap);
  } catch {
    pixels = null; // colours then come from the model alone
  }
  bitmap.close();
  if (Math.min(width, height) < PHOTO_LIMITS.minSide) return `The photo is only ${width} × ${height} px; at least ${PHOTO_LIMITS.minSide} px on each side is needed.`;
  if (width * height > PHOTO_LIMITS.maxPixels) return `The photo has ${((width * height) / 1e6).toFixed(0)} megapixels; the limit is 50.`;
  return { file, url: URL.createObjectURL(file), widthPx: width, heightPx: height, sha256: await sha256Hex(buffer), mediaType, pixels };
}

/** A copy for the vision model: at most 1600 px, re-encoded as JPEG, so no metadata goes with it. */
async function analysisCopy(photo: Photo): Promise<{ data: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(photo.file, { imageOrientation: "from-image" });
  const scale = Math.min(1, PHOTO_LIMITS.analysisSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width, height };
}

function visionNote(assist: AssistState): { available: boolean; text: string; model: LanguageModelRef | null } {
  if (assist.status !== "known") return { available: false, text: "The assistant's status is not known yet.", model: null };
  const a: AssistStatus = assist.assist;
  if (!a.available || !a.vision_model || !a.service || !a.base_url) return { available: false, text: "Photo analysis is off (no provider configured). You can mark the objects yourself.", model: null };
  const model = { service: a.service, base_url: a.base_url, model: a.vision_model };
  if (a.mode === "recorded") return { available: true, text: `Offline test provider: replays recorded answers of ${a.vision_model}. Not live AI.`, model };
  const host = a.base_url.replace(/^https?:\/\//, "").split("/")[0];
  return {
    available: true,
    text: `Analysing sends a smaller copy of this photo, without its metadata, to ${a.service} (${a.vision_model} at ${host}). The original stays on this computer.`,
    model,
  };
}

const DEFAULT_CORNERS: ScaleInput["corners"] = [
  { u: 0.38, v: 0.72 },
  { u: 0.62, v: 0.72 },
  { u: 0.66, v: 0.86 },
  { u: 0.34, v: 0.86 },
];

export function PhotoImport({ client, assist, onCreated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [result, setResult] = useState<ImageProposalResult | null>(null);
  const [scale, setScale] = useState<ScaleInput>({ corners: DEFAULT_CORNERS, feature: "", widthM: null, depthM: null });
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"objects" | "scale" | "layout">("objects");
  const [creating, setCreating] = useState<{ busy: boolean; status: string; error: string | null }>({ busy: false, status: "", error: null });
  const [details, setDetails] = useState(false);
  const note = visionNote(assist);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      pending.current?.abort();
      element?.close();
    };
  }, []);

  const photo = step.kind === "choose" ? null : step.photo;
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const calibration = useMemo((): { ok: true; calibration: Calibration } | { ok: false; message: string } | null => {
    if (!photo || scale.widthM === null) return null;
    return calibrateFromRectangle({ corners: scale.corners, widthM: scale.widthM, depthM: scale.depthM, imageWidthPx: photo.widthPx, imageHeightPx: photo.heightPx });
  }, [photo, scale]);
  const cal = calibration?.ok ? calibration.calibration : null;
  const placed = useMemo(() => (cal ? placeItems(cal, items) : new Map()), [cal, items]);
  const accepted = items.filter((i) => i.decision === "accepted");
  const unplaced = accepted.filter((i) => !isPlaced(placed.get(i.id)));

  async function choose(file: File) {
    const read = await readPhoto(file);
    if (typeof read === "string") return setStep({ kind: "choose", error: read });
    setItems([]);
    setResult(null);
    setStep({ kind: "ready", photo: read });
  }

  async function analyse(target: Photo) {
    const controller = new AbortController();
    pending.current = controller;
    setStep({ kind: "analysing", photo: target, startedAt: Date.now() });
    let response;
    try {
      const copy = await analysisCopy(target);
      response = await client.analysePhoto(
        { media_type: "image/jpeg", data_base64: copy.data, width_px: copy.width, height_px: copy.height, original_sha256: target.sha256 },
        controller.signal,
      );
    } catch {
      if (controller.signal.aborted) return setStep({ kind: "ready", photo: target });
      return setStep({ kind: "failed", photo: target, message: "The photo copy could not be prepared." });
    }
    if (!response.ok) return setStep({ kind: "failed", photo: target, message: response.error.message });
    setResult(response.value);
    if (response.value.outcome === "unsupported" || !response.value.proposal) {
      return setStep({ kind: "failed", photo: target, message: response.value.message ?? "No objects were found." });
    }
    setItems(withPhotoColours(reviewItemsFrom(response.value.proposal), target.pixels));
    const suggestion = response.value.proposal.floor_rectangles[0];
    if (suggestion) setScale((s) => ({ ...s, corners: suggestion.corners as ScaleInput["corners"], feature: s.feature || suggestion.label }));
    setStep({ kind: "review", photo: target });
  }

  function markMyself(target: Photo) {
    setItems([]);
    setResult(null);
    setStep({ kind: "review", photo: target });
  }

  const update = (id: string, patch: Partial<ReviewItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  async function create() {
    if (!photo || !cal || scale.widthM === null) return;
    setCreating({ busy: true, status: "Saving the photo in the source library…", error: null });
    const stored = await client.uploadPhoto(photo.file, photo.file.name);
    if (!stored.ok) return setCreating({ busy: false, status: "", error: stored.error.message });
    const assets = new Map<string, CatalogAsset>();
    const ready = accepted.filter((i) => isPlaced(placed.get(i.id)));
    for (const [index, item] of ready.entries()) {
      setCreating({ busy: true, status: `Building object ${index + 1} of ${ready.length}…`, error: null });
      const request = assetRequest(placed.get(item.id) as PlacedItem, { filename: stored.value.filename, feature: scale.feature || "floor rectangle", visionModel: result ? { service: result.provider.service, base_url: result.provider.base_url, model: result.provider.model } : null });
      const asset = await client.createGeneratedAsset(request);
      if (!asset.ok) return setCreating({ busy: false, status: "", error: `${item.label}: ${"issues" in asset.error && asset.error.issues[0] ? asset.error.issues[0].message : asset.error.message}` });
      assets.set(item.id, asset.value);
    }
    setCreating({ busy: true, status: "Checking the new project…", error: null });
    const project = buildPhotoProject({
      stored: stored.value,
      scale: { ...scale, feature: scale.feature || "floor rectangle", widthM: scale.widthM },
      calibration: cal,
      items,
      placed,
      assets,
      visionModel: result ? { service: result.provider.service, base_url: result.provider.base_url, model: result.provider.model } : null,
      visibleText: result?.proposal?.visible_text ?? [],
    });
    const verdict = await client.validateProjectDocument(JSON.stringify(project));
    if (!verdict.ok) {
      const first = "issues" in verdict.error ? verdict.error.issues[0] : undefined;
      return setCreating({ busy: false, status: "", error: first ? `${first.message} (${first.path})` : verdict.error.message });
    }
    setCreating({ busy: false, status: "", error: null });
    onCreated(project, stored.value.filename);
  }

  const canCreate = cal !== null && accepted.length > 0 && unplaced.length === 0 && scale.feature.trim().length > 0;

  return (
    <dialog
      ref={dialog}
      className="modal photo-import"
      aria-labelledby="photo-title"
      data-testid="photo-import"
      onCancel={(e) => {
        e.preventDefault();
        if (!creating.busy) onClose();
      }}
    >
      <header className="create-head">
        <h2 id="photo-title">Start from a photo</h2>
        <button type="button" className="button" onClick={onClose} disabled={creating.busy}>
          Close
        </button>
      </header>

      {step.kind === "choose" && (
        <div
          className="photo-drop"
          data-testid="photo-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void choose(file);
          }}
        >
          <p>
            <strong>Choose one photo of a room or work area</strong> in which the floor is visible and a <strong>rectangle lying on the floor</strong> (a
            rug, a mat, floor tiles, a pallet) shows a size you know. That rectangle sets the scale.
          </p>
          <p className="muted small">JPEG, PNG or WebP · up to 15 MB and 50 megapixels · at least 64 px on each side · only photos you are allowed to use.</p>
          <button type="button" className="button button-primary" data-testid="photo-choose" onClick={() => fileInput.current?.click()}>
            Choose a photo…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            data-testid="photo-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void choose(file);
            }}
          />
          {step.error && (
            <p className="status-error" role="alert" data-testid="photo-error">
              {step.error} Nothing was changed.
            </p>
          )}
        </div>
      )}

      {photo && step.kind !== "review" && (
        <div className="photo-prepare">
          <div className="photo-frame" style={{ aspectRatio: `${photo.widthPx} / ${photo.heightPx}` }}>
            <img src={photo.url} alt="The chosen photo" data-testid="photo-image" />
            {step.kind === "analysing" && <Analysing startedAt={step.startedAt} />}
          </div>
          <div className="photo-side">
            <p className="muted small">
              {photo.file.name} · {photo.widthPx} × {photo.heightPx} px
            </p>
            {step.kind === "ready" && (
              <>
                <p className="routing" data-testid="photo-routing">
                  {note.text}
                </p>
                <div className="modal-actions">
                  <button type="button" className="button button-primary" disabled={!note.available} data-testid="photo-analyse" onClick={() => void analyse(photo)}>
                    Analyse with {assist.status === "known" && assist.assist.service ? assist.assist.service : "the assistant"}
                  </button>
                  <button type="button" className="button" data-testid="photo-manual" onClick={() => markMyself(photo)}>
                    Mark objects myself
                  </button>
                  <button type="button" className="link-button" onClick={() => setStep({ kind: "choose", error: null })}>
                    Choose another photo
                  </button>
                </div>
              </>
            )}
            {step.kind === "analysing" && (
              <div className="modal-actions">
                <button
                  type="button"
                  className="button"
                  data-testid="photo-cancel"
                  onClick={() => {
                    pending.current?.abort();
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {step.kind === "failed" && (
              <>
                <p className="status-error" role="alert" data-testid="photo-failed">
                  {step.message} The current project is unchanged.
                </p>
                <div className="modal-actions">
                  <button type="button" className="button button-primary" disabled={!note.available} data-testid="photo-retry" onClick={() => void analyse(photo)}>
                    Try again
                  </button>
                  <button type="button" className="button" onClick={() => markMyself(photo)}>
                    Mark objects myself
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {step.kind === "review" && photo && (
        <div className="photo-review">
          <PhotoStage
            photo={photo}
            items={items}
            selected={selected}
            scale={scale}
            calibration={cal}
            placed={placed}
            onSelect={setSelected}
            onItem={update}
            onCorners={(corners) => setScale((s) => ({ ...s, corners }))}
            onAdd={(box) => {
              const [item] = withPhotoColours([userItem(items, box)], photo.pixels) as [ReviewItem];
              setItems((list) => [...list, item]);
              setSelected(item.id);
              setTab("objects");
            }}
          />
          <div className="photo-side">
            <div className="segmented photo-tabs" role="tablist">
              {(["objects", "scale", "layout"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t} data-testid={`photo-tab-${t}`} onClick={() => setTab(t)}>
                  {t === "objects" ? `1 Objects (${accepted.length})` : t === "scale" ? "2 Scale" : "3 Layout"}
                </button>
              ))}
            </div>
            {tab === "objects" && (
              <ObjectsPanel items={items} placed={placed} selected={selected} onSelect={setSelected} onItem={update} hasModel={result !== null} />
            )}
            {tab === "scale" && <ScalePanel scale={scale} calibration={calibration} onScale={setScale} suggestion={result?.proposal?.floor_rectangles[0]?.label ?? null} />}
            {tab === "layout" && <LayoutPanel items={items} placed={placed} calibration={cal} scale={scale} selected={selected} onSelect={setSelected} />}

            <div className="photo-footer">
              {!cal && <p className="muted small" data-testid="photo-needs-scale">Give the scale first: mark a floor rectangle and enter at least one of its sides (tab 2).</p>}
              {unplaced.length > 0 && cal && (
                <p className="status-warn small" data-testid="photo-unplaced">
                  {unplaced.length} accepted object{unplaced.length > 1 ? "s need" : " needs"} a floor point on the floor: {unplaced.map((i) => i.label).join(", ")}.
                </p>
              )}
              {creating.error && (
                <p className="status-error small" role="alert" data-testid="photo-create-error">
                  {creating.error} The current project is unchanged.
                </p>
              )}
              {creating.busy && <p className="muted small" role="status">{creating.status}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-primary" disabled={!canCreate || creating.busy} data-testid="photo-create" onClick={() => void create()}>
                  Create the 3D world ({accepted.length - unplaced.length} objects)
                </button>
                <button type="button" className="link-button" aria-expanded={details} onClick={() => setDetails(!details)}>
                  {details ? "Hide details" : "Details"}
                </button>
              </div>
              {details && (
                <dl className="facts create-details" data-testid="photo-details">
                  <dt>Analysed by</dt>
                  <dd>
                    {result
                      ? `${result.provider.service} · ${result.provider.model} · ${result.provider.mode === "live" ? "live" : "recorded offline test answer (not live AI)"} · ${(result.provider.latency_ms / 1000).toFixed(1)} s`
                      : "Nobody: objects marked by you"}
                  </dd>
                  <dt>Photo</dt>
                  <dd>
                    {photo.file.name}, sha256 <span className="mono">{photo.sha256.slice(0, 16)}…</span>; the original is kept only in this computer&apos;s source library.
                  </dd>
                  {result?.proposal && result.proposal.visible_text.length > 0 && (
                    <>
                      <dt>Text in the photo</dt>
                      <dd>“{result.proposal.visible_text.join("”, “")}” (read as content, never as instructions)</dd>
                    </>
                  )}
                  {result && result.checks.length > 0 && (
                    <>
                      <dt>Checks</dt>
                      <dd>{result.checks.join(" ")}</dd>
                    </>
                  )}
                  <dt>Approximate</dt>
                  <dd>
                    Positions come from where objects meet the floor in the photo, mapped with your rectangle; hidden depths are guesses; heights use the reconstructed camera.
                    Nothing is a measurement until you type it.
                  </dd>
                </dl>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

function Analysing({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="photo-analysing" role="status" data-testid="photo-analysing">
      <span className="spinner" aria-hidden="true" />
      Looking for objects… {Math.max(0, Math.round((now - startedAt) / 1000))} s (usually 25–70 s)
    </div>
  );
}

type Drag =
  | { kind: "corner"; index: number }
  | { kind: "contact"; id: string }
  | { kind: "edge"; id: string; edge: "left" | "right" | "top" | "bottom" }
  | { kind: "new"; start: ImagePoint; now: ImagePoint };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface StageProps {
  photo: Photo;
  items: ReviewItem[];
  selected: string | null;
  scale: ScaleInput;
  calibration: Calibration | null;
  placed: Map<string, PlacedItem | { problem: string }>;
  onSelect: (id: string | null) => void;
  onItem: (id: string, patch: Partial<ReviewItem>) => void;
  onCorners: (corners: ScaleInput["corners"]) => void;
  onAdd: (box: ImageBox) => void;
}

/** The photo with everything that was detected or marked drawn exactly where it was found. */
function PhotoStage({ photo, items, selected, scale, calibration, placed, onSelect, onItem, onCorners, onAdd }: StageProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState(false);
  const [footprints, setFootprints] = useState(true);

  // Events come from the stage or from handles inside it; positions are always on the stage.
  const stageOf = (e: ReactPointerEvent) => (e.currentTarget as Element).closest<HTMLElement>(".photo-stage")!;
  const at = (e: ReactPointerEvent): ImagePoint => {
    const r = stageOf(e).getBoundingClientRect();
    return { u: clamp01((e.clientX - r.left) / r.width), v: clamp01((e.clientY - r.top) / r.height) };
  };
  const begin = (e: ReactPointerEvent, next: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    stageOf(e).setPointerCapture(e.pointerId);
    setDrag(next);
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = at(e);
    if (drag.kind === "corner") {
      const corners = scale.corners.map((c, i) => (i === drag.index ? p : c)) as ScaleInput["corners"];
      onCorners(corners);
    } else if (drag.kind === "contact") {
      onItem(drag.id, { contact: p, contactBasis: "user" });
    } else if (drag.kind === "edge") {
      const item = items.find((i) => i.id === drag.id);
      if (!item) return;
      const box = { ...item.box };
      if (drag.edge === "left") box.left = Math.min(p.u, box.right - 0.01);
      if (drag.edge === "right") box.right = Math.max(p.u, box.left + 0.01);
      if (drag.edge === "top") box.top = Math.min(p.v, box.bottom - 0.01);
      if (drag.edge === "bottom") box.bottom = Math.max(p.v, box.top + 0.01);
      // A floor point taken from the outline's bottom keeps following it.
      onItem(drag.id, item.contactBasis === "box_bottom" ? { box, contact: { u: (box.left + box.right) / 2, v: box.bottom }, contactBasis: "box_bottom" } : { box });
    } else {
      setDrag({ ...drag, now: p });
    }
  };
  const end = () => {
    if (drag?.kind === "new") {
      const box = { left: Math.min(drag.start.u, drag.now.u), right: Math.max(drag.start.u, drag.now.u), top: Math.min(drag.start.v, drag.now.v), bottom: Math.max(drag.start.v, drag.now.v) };
      if (box.right - box.left > 0.015 && box.bottom - box.top > 0.015) onAdd(box);
      setAdding(false);
    }
    setDrag(null);
  };

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const footprintPolygons = useMemo(() => {
    if (!calibration || !footprints) return [];
    const polygons: { id: string; points: string }[] = [];
    for (const item of items) {
      const p = placed.get(item.id);
      if (!isPlaced(p)) continue;
      const c = Math.cos(p.yawRad);
      const s = Math.sin(p.yawRad);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const lx = (a! * p.width) / 2;
        const lz = (b! * p.depth) / 2;
        return imagePointOf(calibration, p.x + lx * c + lz * s, 0, p.z - lx * s + lz * c);
      });
      if (corners.every((q) => q)) polygons.push({ id: item.id, points: corners.map((q) => `${q!.u * 1000},${q!.v * 1000}`).join(" ") });
    }
    return polygons;
  }, [calibration, footprints, items, placed]);

  return (
    <div className="photo-stage-wrap">
      <div className="photo-toolbar">
        <button type="button" className={`button button-small${adding ? " button-primary" : ""}`} aria-pressed={adding} data-testid="photo-add" onClick={() => setAdding(!adding)}>
          {adding ? "Drag a box around the object…" : "Add a missed object"}
        </button>
        <label className="small">
          <input type="checkbox" checked={footprints} onChange={(e) => setFootprints(e.target.checked)} /> Show floor footprints
        </label>
        <span className="muted small">Drag a floor point (●) or a box edge to correct it; drag the gold corners onto your floor rectangle.</span>
      </div>
      <div
        className={`photo-frame photo-stage${adding ? " adding" : ""}`}
        data-testid="photo-stage"
        style={{ aspectRatio: `${photo.widthPx} / ${photo.heightPx}` }}
        onPointerDown={(e) => {
          if (adding) {
            const p = at(e);
            begin(e, { kind: "new", start: p, now: p });
          } else onSelect(null);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img src={photo.url} alt="The photo under review" draggable={false} />
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="photo-svg" aria-hidden="true">
          {footprintPolygons.map((f) => (
            <polygon key={f.id} points={f.points} className={`footprint${f.id === selected ? " selected" : ""}`} vectorEffect="non-scaling-stroke" />
          ))}
          <polygon points={scale.corners.map((c) => `${c.u * 1000},${c.v * 1000}`).join(" ")} className="scale-rect" vectorEffect="non-scaling-stroke" />
          <line
            x1={scale.corners[0].u * 1000}
            y1={scale.corners[0].v * 1000}
            x2={scale.corners[1].u * 1000}
            y2={scale.corners[1].v * 1000}
            className="scale-width"
            vectorEffect="non-scaling-stroke"
          />
          {drag?.kind === "new" && (
            <rect
              x={Math.min(drag.start.u, drag.now.u) * 1000}
              y={Math.min(drag.start.v, drag.now.v) * 1000}
              width={Math.abs(drag.now.u - drag.start.u) * 1000}
              height={Math.abs(drag.now.v - drag.start.v) * 1000}
              className="new-box"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {items.map((item, index) => {
          const b = item.box;
          const isSelected = item.id === selected;
          return (
            <div
              key={item.id}
              className={`photo-box ${item.decision}${isSelected ? " selected" : ""}`}
              data-testid={`photo-box-${item.id}`}
              style={{ left: pct(b.left), top: pct(b.top), width: pct(b.right - b.left), height: pct(b.bottom - b.top) }}
              onPointerDown={(e) => {
                if (adding) return;
                e.stopPropagation();
                onSelect(item.id);
              }}
            >
              <span className="photo-box-label">
                {index + 1} {item.label}
              </span>
              {isSelected &&
                (["left", "right", "top", "bottom"] as const).map((edge) => (
                  <span key={edge} className={`edge-handle edge-${edge}`} onPointerDown={(e) => begin(e, { kind: "edge", id: item.id, edge })} />
                ))}
            </div>
          );
        })}
        {items.map((item) =>
          item.contact && item.decision === "accepted" ? (
            <span
              key={`c-${item.id}`}
              className={`contact-handle${item.id === selected ? " selected" : ""}`}
              data-testid={`photo-contact-${item.id}`}
              title={`Where ${item.label} meets the floor (${item.contactBasis === "user" ? "set by you" : item.contactBasis === "box_bottom" ? "bottom of its outline" : "the model's point"})`}
              style={{ left: pct(item.contact.u), top: pct(item.contact.v) }}
              onPointerDown={(e) => {
                onSelect(item.id);
                begin(e, { kind: "contact", id: item.id });
              }}
            />
          ) : null,
        )}
        {scale.corners.map((c, i) => (
          <span
            key={`k-${i}`}
            className="corner-handle"
            data-testid={`photo-corner-${i}`}
            title={`Floor rectangle corner ${i + 1}${i < 2 ? " (the width runs from corner 1 to 2)" : ""}`}
            style={{ left: pct(c.u), top: pct(c.v) }}
            onPointerDown={(e) => begin(e, { kind: "corner", index: i })}
          >
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function SizeInput({ value, label, testId, onCommit }: { value: number | null; label: string; testId: string; onCommit: (v: number | null) => void }) {
  const shown = value === null ? "" : formatFixed(value, LENGTH_DECIMALS);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === "") {
      setError(null);
      return onCommit(null);
    }
    const parsed = parseDecimal(text, LENGTH_DECIMALS, "m");
    if (!parsed.ok) return setError(parsed.message);
    if (parsed.value < 0.05 || parsed.value > 50) return setError("Use 0.05–50 m.");
    setError(null);
    onCommit(parsed.value);
  };
  return (
    <span className="size-input">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        data-testid={testId}
        value={draft ?? shown}
        placeholder="m"
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="unit">m</span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

const SOURCE_TAG = { photo: "from the photo, approximate", hidden: "hidden: a guess", entered: "entered by you" } as const;

function ObjectsPanel(props: {
  items: ReviewItem[];
  placed: Map<string, PlacedItem | { problem: string }>;
  selected: string | null;
  hasModel: boolean;
  onSelect: (id: string) => void;
  onItem: (id: string, patch: Partial<ReviewItem>) => void;
}) {
  const { items, placed, selected, hasModel, onSelect, onItem } = props;
  if (items.length === 0) {
    return (
      <p className="muted small" data-testid="photo-no-objects">
        {hasModel ? "No objects were proposed." : "No objects yet."} Use “Add a missed object” and drag a box around each object on the photo.
      </p>
    );
  }
  return (
    <ul className="photo-objects" data-testid="photo-objects">
      {items.map((item, index) => {
        const p = placed.get(item.id);
        const open = item.id === selected;
        return (
          <li key={item.id} className={`photo-object ${item.decision}${open ? " open" : ""}`} data-testid={`photo-object-${item.id}`}>
            <div className="photo-object-head" onClick={() => onSelect(item.id)}>
              <input
                type="checkbox"
                aria-label={`Use ${item.label}`}
                checked={item.decision === "accepted"}
                data-testid={`photo-accept-${item.id}`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onItem(item.id, { decision: e.target.checked ? "accepted" : "rejected" })}
              />
              <span className="badge">{index + 1}</span>
              <span className="photo-object-name">{item.label}</span>
              <span className="muted small">{TEMPLATE_NAME[item.template]}</span>
            </div>
            {open && (
              <div className="photo-object-body">
                <label className="photo-field">
                  <span>Name</span>
                  <input type="text" value={item.label} maxLength={80} onChange={(e) => onItem(item.id, { label: e.target.value })} />
                </label>
                <label className="photo-field">
                  <span>Shape</span>
                  <select value={item.template} data-testid={`photo-template-${item.id}`} onChange={(e) => onItem(item.id, { template: e.target.value as PhotoTemplate })}>
                    {TEMPLATE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {TEMPLATE_NAME[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="photo-field">
                  <span>Colour</span>
                  <select value={item.material} onChange={(e) => onItem(item.id, { material: e.target.value as GeometryPart["material"] })}>
                    {[...new Set([item.material, ...COLOURS])].map((m) => (
                      <option key={m} value={m}>
                        {m.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="photo-field">
                  <span>Facing</span>
                  <select value={item.facing} onChange={(e) => {
                      const { yawDeg: _, ...entered } = item.entered;
                      onItem(item.id, { facing: e.target.value as ReviewItem["facing"], entered });
                    }}>
                    <option value="toward_camera">towards the camera</option>
                    <option value="left">to the left of the photo</option>
                    <option value="right">to the right of the photo</option>
                    <option value="away">away from the camera</option>
                    <option value="unknown">not sure (towards the camera)</option>
                  </select>
                </label>
                {isPlaced(p) ? (
                  <div className="photo-dims">
                    {(["width", "height", "depth"] as const).map((axis) => (
                      <div key={axis} className="size-row">
                        <span className="size-label">{axis[0]!.toUpperCase() + axis.slice(1)}</span>
                        <SizeInput
                          value={p[axis]}
                          label={`${item.label} ${axis} in metres`}
                          testId={`photo-${axis}-${item.id}`}
                          onCommit={(v) => {
                            const { [axis]: _, ...rest } = item.entered;
                            onItem(item.id, { entered: v === null ? rest : { ...rest, [axis]: v } });
                          }}
                        />
                        <span className={`size-tag${p.source[axis] === "entered" ? " size-tag-entered" : ""}`}>{SOURCE_TAG[p.source[axis]]}</span>
                      </div>
                    ))}
                  </div>
                ) : p ? (
                  <p className="status-warn small">{p.problem}</p>
                ) : (
                  <p className="muted small">Sizes appear once the scale is set (tab 2).</p>
                )}
                {[...item.notes, ...(isPlaced(p) ? p.notes : [])].length > 0 && (
                  <ul className="create-checks">
                    {[...new Set([...item.notes, ...(isPlaced(p) ? p.notes : [])])].map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ScalePanel({ scale, calibration, suggestion, onScale }: { scale: ScaleInput; calibration: ReturnType<typeof calibrateFromRectangle> | null; suggestion: string | null; onScale: (s: ScaleInput) => void }) {
  const cal = calibration?.ok ? calibration.calibration : null;
  return (
    <section className="photo-scale" data-testid="photo-scale">
      <p className="small">
        Find a <strong>rectangle lying flat on the floor</strong> whose size you know - a rug, a mat, floor tiles, a pallet - and drag the four gold corners onto
        its corners. Corners <strong>1 → 2</strong> run along the side you measured (the width).
      </p>
      {suggestion && <p className="muted small">The corners start on the model&apos;s guess of “{suggestion}”; place them on the real corners.</p>}
      <label className="photo-field">
        <span>What is it?</span>
        <input type="text" value={scale.feature} placeholder="e.g. rug" maxLength={80} data-testid="photo-feature" onChange={(e) => onScale({ ...scale, feature: e.target.value })} />
      </label>
      <div className="size-row">
        <span className="size-label">Width (1 → 2)</span>
        <SizeInput value={scale.widthM} label="Rectangle width in metres" testId="photo-scale-width" onCommit={(v) => onScale({ ...scale, widthM: v })} />
        <span className="size-tag">measured by you</span>
      </div>
      <div className="size-row">
        <span className="size-label">Depth (2 → 3)</span>
        <SizeInput value={scale.depthM} label="Rectangle depth in metres" testId="photo-scale-depth" onCommit={(v) => onScale({ ...scale, depthM: v })} />
        <span className="size-tag">{scale.depthM === null ? (cal ? `not known: ${formatFixed(cal.depthM, 2)} m derived from perspective` : "optional") : "measured by you"}</span>
      </div>
      {calibration && !calibration.ok && (
        <p className="status-error small" role="alert" data-testid="photo-scale-error">
          {calibration.message}
        </p>
      )}
      {!calibration && <p className="muted small">Enter at least the width to set the scale. Without it, sizes and distances would be guesses.</p>}
      {cal && (
        <>
          <p className="small" data-testid="photo-scale-summary">
            Camera about {formatFixed(cal.camera.y, 2)} m above the floor, {formatFixed(cal.verticalFovDeg, 0)}° view ({cal.fovBasis === "from_rectangle" ? "from your rectangle" : cal.fovBasis === "from_sides" ? "from your two side lengths" : "assumed typical lens"}).
          </p>
          {cal.warnings.length > 0 && (
            <ul className="create-checks" data-testid="photo-scale-warnings">
              {cal.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="muted small">
            One measured length fixes the scale on the floor only. Depths you did not measure, hidden sides and heights stay estimates, and positions far
            from the rectangle or near the horizon are least certain.
          </p>
        </>
      )}
    </section>
  );
}

/** A top-down check of where everything will go before the world is created. */
function LayoutPanel({ items, placed, calibration, scale, selected, onSelect }: { items: ReviewItem[]; placed: Map<string, PlacedItem | { problem: string }>; calibration: Calibration | null; scale: ScaleInput; selected: string | null; onSelect: (id: string) => void }) {
  if (!calibration) return <p className="muted small">The layout appears once the scale is set.</p>;
  const shapes: ReactNode[] = [];
  const xs: number[] = [calibration.camera.x];
  const zs: number[] = [calibration.camera.z];
  const halfW = calibration.widthM / 2;
  const halfD = calibration.depthM / 2;
  void scale;
  items.forEach((item, index) => {
    const p = placed.get(item.id);
    if (!isPlaced(p)) return;
    xs.push(p.x - p.width, p.x + p.width);
    zs.push(p.z - p.depth, p.z + p.depth);
    const deg = (-p.yawRad * 180) / Math.PI;
    shapes.push(
      <g key={item.id} transform={`translate(${p.x} ${p.z}) rotate(${deg})`} onClick={() => onSelect(item.id)} className={`plan-item${item.id === selected ? " selected" : ""}`}>
        <rect x={-p.width / 2} y={-p.depth / 2} width={p.width} height={p.depth} />
        <line x1={0} y1={0} x2={0} y2={p.depth / 2} className="plan-front" />
        <text x={0} y={0} fontSize={Math.max(0.18, Math.min(p.width, p.depth) * 0.45)} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${-deg})`}>
          {index + 1}
        </text>
      </g>,
    );
  });
  const minX = Math.min(...xs, -halfW) - 0.5;
  const maxX = Math.max(...xs, halfW) + 0.5;
  const minZ = Math.min(...zs, -halfD) - 0.5;
  const maxZ = Math.max(...zs, halfD) + 0.5;
  return (
    <section data-testid="photo-layout">
      <p className="small">From above: the camera is at the bottom (▲), the photo&apos;s left is on the left. The gold outline is your floor rectangle.</p>
      <svg className="photo-plan" viewBox={`${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`} preserveAspectRatio="xMidYMid meet">
        <rect x={minX} y={minZ} width={maxX - minX} height={maxZ - minZ} className="plan-floor" />
        {/* The rectangle's own orientation is shown approximately by its axis-aligned extent. */}
        <rect x={-halfW} y={-halfD} width={2 * halfW} height={2 * halfD} className="plan-reference" />
        {shapes}
        <path d={`M ${calibration.camera.x} ${calibration.camera.z - 0.3} l 0.25 0.45 l -0.5 0 z`} className="plan-camera" />
      </svg>
      <p className="muted small">Positions are approximate; you can move, turn and resize everything in the editor afterwards.</p>
    </section>
  );
}
