// Create an object without CAD: describe it in ordinary words (a language model drafts a typed
// proposal) or start from a plain shape in the builder. Either way the user sees a verified
// preview, confirms the sizes that were estimated, and places it in the scene through the same
// command path as every other edit. Evidence stays available behind "Details".
import type { AssistStatus, CatalogAsset, GeneratedModel, GeometryPart, ObjectProposalResult } from "@replay-world/contracts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import {
  AXIS_OF,
  canPlace,
  confirmAll,
  confirmDimension,
  DIMENSIONS,
  type DimensionKey,
  draftFromProposal,
  draftFromTemplate,
  ENVELOPE_LIMITS,
  type ObjectDraft,
  setDimension,
  setParts,
  sizeOf,
  toAssetRequest,
  unconfirmed,
  withFittedSpec,
} from "../assist/objectDraft";
import { EXAMPLE_DESCRIPTIONS, TEMPLATES } from "../assist/templates";
import { formatFixed, LENGTH_DECIMALS, parseDecimal } from "../editing/units";
import type { AssistState } from "../hooks/useAssistStatus";
import { ModelPreview } from "../scene/ModelPreview";
import { PartsEditor } from "./PartsEditor";

type Step =
  | { kind: "describe"; text: string; notice: { tone: "question" | "warning" | "error"; text: string } | null }
  | { kind: "waiting"; text: string; startedAt: number }
  | { kind: "review"; draft: ObjectDraft; result: ObjectProposalResult | null; editingParts: boolean };

type Preview = { key: string; status: "building" } | { key: string; status: "ready"; model: GeneratedModel } | { key: string; status: "failed"; message: string };

interface Props {
  client: ApiClient;
  assist: AssistState;
  /** Start in the builder rather than the description step. */
  startWith: "describe" | "builder";
  /** Words and sizes from the conversation (UX-04): the description, or the builder's name and
   * envelope. Nothing else is assumed from them. */
  initial?: { text: string; name: string; size: { width: number | null; depth: number | null; height: number | null } } | null;
  onPlace: (asset: CatalogAsset) => void;
  onClose: () => void;
  /** Making the model of an existing object (UX-05): the draft takes its recorded size. */
  fitTo?: { width: number; depth: number; height: number } | null;
  /** The final button's words, when it does something other than place a new object. */
  placeLabel?: string;
}

const SIZE_LABEL: Record<DimensionKey, string> = { width: "Width", height: "Height", depth: "Depth" };

function assistNote(assist: AssistState): { available: boolean; text: string } {
  if (assist.status === "checking") return { available: false, text: "Checking whether the description assistant is available…" };
  if (assist.status === "unreachable") return { available: false, text: `The API could not be reached (${assist.message}).` };
  const a: AssistStatus = assist.assist;
  if (!a.available) return { available: false, text: a.message };
  if (a.mode === "recorded") return { available: true, text: `${a.message} Model of the recordings: ${a.model}.` };
  return { available: true, text: `Your description is sent to ${a.service} (${a.model}) to draft a proposal. Nothing else from the project is sent.` };
}

export function CreateObject({ client, assist, startWith, onPlace, onClose, initial = null, fitTo = null, placeLabel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>(() => {
    if (startWith !== "builder") return { kind: "describe", text: initial?.text ?? "", notice: null };
    const spec = structuredClone(TEMPLATES[0]!.spec);
    const size = initial?.size;
    if (size) spec.envelope_m = { x: size.width ?? spec.envelope_m.x, y: size.height ?? spec.envelope_m.y, z: size.depth ?? spec.envelope_m.z };
    return { kind: "review", draft: draftFromTemplate(initial?.name ?? "Box", "box", spec), result: null, editingParts: true };
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [placing, setPlacing] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [details, setDetails] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const note = assistNote(assist);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      pending.current?.abort();
      element?.close();
    };
  }, []);

  // Rebuild the preview whenever the specification changes (debounced). The API fits the parts
  // to the overall size; its fitted version replaces the draft's so later edits start from it.
  const spec = step.kind === "review" ? step.draft.spec : null;
  const specKey = useMemo(() => (spec ? JSON.stringify(spec) : ""), [spec]);
  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreview((p) => (p?.key === specKey && p.status === "ready" ? p : { key: specKey, status: "building" }));
      client.previewGeneratedModel(spec, controller.signal).then(
        (result) => {
          if (!result.ok) {
            setPreview({ key: specKey, status: "failed", message: result.error.message });
            return;
          }
          const fittedKey = JSON.stringify(result.value.spec);
          setPreview({ key: fittedKey, status: "ready", model: result.value });
          if (fittedKey !== specKey) {
            setStep((s) => (s.kind === "review" ? { ...s, draft: withFittedSpec(s.draft, result.value.spec) } : s));
          }
        },
        () => undefined,
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, spec, specKey]);

  async function describe(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setStep({ kind: "describe", text, notice: { tone: "warning", text: "Describe the object in a few words first." } });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setStep({ kind: "waiting", text, startedAt: Date.now() });
    let result;
    try {
      result = await client.proposeObject(trimmed, controller.signal);
    } catch {
      setStep({ kind: "describe", text, notice: null }); // cancelled
      return;
    }
    if (!result.ok) {
      setStep({ kind: "describe", text, notice: { tone: "error", text: result.error.message } });
      return;
    }
    const value = result.value;
    if (value.outcome === "clarification") {
      setStep({ kind: "describe", text, notice: { tone: "question", text: value.question ?? "Could you say more?" } });
    } else if (value.outcome === "unsupported") {
      setStep({ kind: "describe", text, notice: { tone: "warning", text: value.message ?? "That cannot be made into an object." } });
    } else {
      const proposed = draftFromProposal(trimmed, value);
      // For an existing object, its recorded size wins over the proposal's: the model is made to
      // fit what the drawing says, and the object's own dimensions are never changed.
      const draft = proposed && fitTo ? (["width", "depth", "height"] as const).reduce((d, key) => setDimension(d, key, fitTo[key]), proposed) : proposed;
      if (draft) setStep({ kind: "review", draft, result: value, editingParts: false });
    }
  }

  async function place(draft: ObjectDraft) {
    setPlacing({ busy: true, error: null });
    const result = await client.createGeneratedAsset(toAssetRequest(draft));
    if (!result.ok) {
      const first = "issues" in result.error ? result.error.issues[0] : undefined;
      setPlacing({ busy: false, error: first ? `${first.message} (${first.path})` : result.error.message });
      return;
    }
    setPlacing({ busy: false, error: null });
    onPlace(result.value);
  }

  const updateDraft = (next: ObjectDraft) => setStep((s) => (s.kind === "review" ? { ...s, draft: next } : s));

  return (
    <dialog
      ref={dialog}
      className="modal create-object"
      aria-labelledby="create-title"
      data-testid="create-object"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="create-head">
        <h2 id="create-title">{step.kind === "review" && step.draft.method === "builder" ? "Build an object" : "Describe an object"}</h2>
        <button type="button" className="button" onClick={onClose} aria-label="Close">
          Close
        </button>
      </header>

      {step.kind === "describe" && (
        <DescribeStep
          text={step.text}
          notice={step.notice}
          available={note.available}
          note={note.text}
          onText={(text) => setStep({ kind: "describe", text, notice: step.notice })}
          onSubmit={(text) => void describe(text)}
          onBuilder={() => setStep({ kind: "review", draft: draftFromTemplate("Box", "box", TEMPLATES[0]!.spec), result: null, editingParts: true })}
        />
      )}

      {step.kind === "waiting" && (
        <Waiting
          startedAt={step.startedAt}
          note={note.text}
          onCancel={() => {
            pending.current?.abort();
            setStep({ kind: "describe", text: step.text, notice: null });
          }}
        />
      )}

      {step.kind === "review" && (
        <div className="create-review">
          <div className="create-main">
            <label className="create-name">
              <span>Name</span>
              <input
                type="text"
                value={step.draft.name}
                maxLength={80}
                data-testid="object-name"
                onChange={(e) => updateDraft({ ...step.draft, name: e.target.value })}
              />
            </label>
            {step.draft.appearance && <p className="muted">{step.draft.appearance}</p>}
            {step.draft.method === "builder" && (
              <Templates
                onPick={(t) => updateDraft({ ...draftFromTemplate(t.name, t.category, t.spec), name: t.name })}
              />
            )}
            <SizeReview draft={step.draft} onChange={updateDraft} />
            {step.editingParts ? (
              <PartsEditor
                parts={step.draft.spec.parts}
                envelope={step.draft.spec.envelope_m}
                onParts={(next) => updateDraft(setParts(step.draft, next))}
              />
            ) : (
              <PartsSummary parts={step.draft.spec.parts} />
            )}
            <p className="unknowns" data-testid="unknowns">
              <strong>Not known:</strong> mass, strength, material chemistry and how it operates. This is a provisional picture
              at the size shown, not a product model.
            </p>
            {step.result && step.result.checks.length > 0 && (
              <ul className="create-checks" data-testid="proposal-checks">
                {step.result.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {placing.error && (
              <p className="status-error" role="alert" data-testid="place-error">
                {placing.error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-primary"
                data-testid="place-generated"
                disabled={!canPlace(step.draft) || placing.busy || preview?.status !== "ready"}
                title={canPlace(step.draft) ? "Add it to the catalog and place it on the floor" : "Confirm the estimated sizes first"}
                onClick={() => void place(step.draft)}
              >
                {placing.busy ? "Saving model…" : (placeLabel ?? "Place in scene")}
              </button>
              <button
                type="button"
                className="button"
                aria-pressed={step.editingParts}
                data-testid="edit-parts"
                onClick={() => setStep({ ...step, editingParts: !step.editingParts })}
              >
                {step.editingParts ? "Done editing parts" : "Edit parts"}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setStep({ kind: "describe", text: step.draft.description ?? "", notice: null })}
              >
                {step.draft.method === "described" ? "Change description" : "Describe instead"}
              </button>
              <button type="button" className="link-button" aria-expanded={details} data-testid="details-toggle" onClick={() => setDetails(!details)}>
                {details ? "Hide details" : "Details"}
              </button>
            </div>
            {details && <Details draft={step.draft} result={step.result} preview={preview?.status === "ready" ? preview.model : null} />}
          </div>
          <ModelPreview model={preview?.status === "ready" ? preview.model : null} busy={preview?.status === "building"} />
          {preview?.status === "failed" && (
            <p className="status-error" role="alert">
              The model could not be built: {preview.message}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}

function DescribeStep(props: {
  text: string;
  notice: { tone: "question" | "warning" | "error"; text: string } | null;
  available: boolean;
  note: string;
  onText: (text: string) => void;
  onSubmit: (text: string) => void;
  onBuilder: () => void;
}) {
  const { text, notice, available, note, onText, onSubmit, onBuilder } = props;
  return (
    <div className="create-describe">
      <label htmlFor="describe-text">What is missing from the scene? Describe it in your own words, with any sizes you know.</label>
      <textarea
        id="describe-text"
        rows={3}
        maxLength={500}
        value={text}
        disabled={!available}
        placeholder={EXAMPLE_DESCRIPTIONS[0]}
        data-testid="describe-text"
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(text);
        }}
      />
      <div className="examples">
        <span className="muted">Try:</span>
        {EXAMPLE_DESCRIPTIONS.map((example) => (
          <button key={example} type="button" className="chip-button" disabled={!available} onClick={() => onText(example)}>
            {example}
          </button>
        ))}
      </div>
      {notice && (
        <p className={notice.tone === "question" ? "create-question" : "status-error"} role="alert" data-testid="describe-notice">
          {notice.tone === "question" ? "Question: " : ""}
          {notice.text}
        </p>
      )}
      <p className="muted routing" data-testid="assist-note">
        {note}
      </p>
      <div className="modal-actions">
        <button type="button" className="button button-primary" disabled={!available} data-testid="describe-submit" onClick={() => onSubmit(text)}>
          Draft a proposal
        </button>
        <button type="button" className="button" data-testid="open-builder" onClick={onBuilder}>
          Build it by hand instead
        </button>
      </div>
    </div>
  );
}

function Waiting({ startedAt, note, onCancel }: { startedAt: number; note: string; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="create-waiting" role="status" data-testid="describe-waiting">
      <p>
        <strong>Drafting a proposal…</strong> {seconds} s
      </p>
      <p className="muted">{note} A detailed answer usually takes 30–90 seconds.</p>
      <button type="button" className="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Templates({ onPick }: { onPick: (t: (typeof TEMPLATES)[number]) => void }) {
  return (
    <div className="examples" data-testid="templates">
      <span className="muted">Start from:</span>
      {TEMPLATES.map((t) => (
        <button key={t.key} type="button" className="chip-button" data-testid={`template-${t.key}`} onClick={() => onPick(t)}>
          {t.name}
        </button>
      ))}
    </div>
  );
}

function SizeField({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => string | null }) {
  const shown = formatFixed(value, LENGTH_DECIMALS);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text.trim() === shown) return setError(null);
    const parsed = parseDecimal(text, LENGTH_DECIMALS, "m");
    if (!parsed.ok) return setError(parsed.message);
    if (parsed.value < ENVELOPE_LIMITS.min || parsed.value > ENVELOPE_LIMITS.max) {
      return setError(`Use ${ENVELOPE_LIMITS.min}–${ENVELOPE_LIMITS.max} m.`);
    }
    setError(onCommit(parsed.value));
  };
  return (
    <span className="size-input">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${label} in metres`}
        data-testid={`size-${label.toLowerCase()}`}
        value={draft ?? shown}
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <span className="unit">m</span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

function SizeReview({ draft, onChange }: { draft: ObjectDraft; onChange: (draft: ObjectDraft) => void }) {
  const size = sizeOf(draft);
  const waiting = unconfirmed(draft);
  return (
    <section className="size-review" aria-label="Size" data-testid="size-review">
      <h3 className="section-title">Size</h3>
      <ul>
        {DIMENSIONS.map((key) => {
          const review = draft.dimensions[key];
          const tag =
            review.basis === "stated"
              ? `from your words: “${review.quote ?? ""}”`
              : review.basis === "entered"
                ? "entered by you"
                : review.confirmed
                  ? "estimate, confirmed"
                  : "estimate - please check";
          return (
            <li key={key} className={!review.confirmed ? "size-row size-unconfirmed" : "size-row"} data-testid={`size-row-${key}`}>
              <span className="size-label">{SIZE_LABEL[key]}</span>
              <SizeField
                value={size[key]}
                label={SIZE_LABEL[key]}
                onCommit={(v) => {
                  onChange(setDimension(draft, key, v));
                  return null;
                }}
              />
              <span className={`size-tag size-tag-${review.basis}`}>{tag}</span>
              {!review.confirmed && (
                <button type="button" className="button button-small" onClick={() => onChange(confirmDimension(draft, key))}>
                  Looks right
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {waiting.length > 0 && (
        <div className="size-confirm">
          <span>
            {waiting.length === 1 ? `The ${waiting[0]} is` : `${waiting.length} sizes are`} estimated. Check {waiting.length === 1 ? "it" : "them"}{" "}
            before placing.
          </span>
          <button type="button" className="button button-primary button-small" data-testid="confirm-sizes" onClick={() => onChange(confirmAll(draft))}>
            Sizes look right
          </button>
        </div>
      )}
    </section>
  );
}

function PartsSummary({ parts }: { parts: readonly GeometryPart[] }) {
  // "leg ×4" instead of four chips; a part the user named is marked.
  const groups = new Map<string, { count: number; stated: boolean }>();
  for (const p of parts) {
    const g = groups.get(p.label) ?? { count: 0, stated: false };
    groups.set(p.label, { count: g.count + 1, stated: g.stated || p.basis === "stated" });
  }
  return (
    <section aria-label="Parts" data-testid="parts-summary">
      <h3 className="section-title">
        Parts <span className="count">{parts.length}</span>
      </h3>
      <ul className="part-chips">
        {[...groups].map(([label, g]) => (
          <li key={label} className={g.stated ? "part-chip part-stated" : "part-chip"} title={g.stated ? "You mentioned this" : "Assumed"}>
            {label}
            {g.count > 1 ? ` ×${g.count}` : ""}
          </li>
        ))}
      </ul>
      <p className="muted small">Highlighted parts are ones you mentioned; the others were assumed to make the object recognisable.</p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Details({ draft, result, preview }: { draft: ObjectDraft; result: ObjectProposalResult | null; preview: GeneratedModel | null }) {
  const run = result?.provider;
  return (
    <section className="create-details" data-testid="create-details">
      <dl className="facts">
        <Fact label="Made by">
          {draft.method === "described" && run
            ? `${run.service} · ${run.model} · ${run.mode === "live" ? "live" : "recorded offline test answer (not live AI)"} · ${(run.latency_ms / 1000).toFixed(1)} s · ${run.attempts} attempt${run.attempts > 1 ? "s" : ""}${run.first_attempt_valid ? "" : " (first answer invalid)"}`
            : "The object builder (no language model)"}
        </Fact>
        {draft.description && <Fact label="Your words">“{draft.description}”</Fact>}
        <Fact label="Stated by you">{draft.statedFacts.length ? draft.statedFacts.join("; ") : "-"}</Fact>
        <Fact label="Assumed">{draft.inferredFacts.length ? draft.inferredFacts.join("; ") : "-"}</Fact>
        {draft.notModelled.length > 0 && <Fact label="Not modelled">{draft.notModelled.join("; ")}</Fact>}
        <Fact label="Unknown">Mass, strength, chemical composition and operating behaviour are recorded as unknown.</Fact>
        <Fact label="Dimensions">
          {DIMENSIONS.map((key) => {
            const r = draft.dimensions[key];
            return `${SIZE_LABEL[key]} ${formatFixed(draft.spec.envelope_m[AXIS_OF[key]], 3)} m (${r.basis}${r.confirmed ? ", confirmed" : ", unconfirmed"})`;
          }).join("; ")}
        </Fact>
        {preview && (
          <>
            <Fact label="Model">
              {preview.triangles.toLocaleString()} triangles · {(preview.bytes / 1024).toFixed(0)} kB · {preview.materials.length} materials · origin
              at bottom-centre, metres, +Y up, front +Z
            </Fact>
            <Fact label="sha256">
              <span className="mono">{preview.visual.sha256}</span>
            </Fact>
            {preview.notes.length > 0 && <Fact label="Fit">{preview.notes.join(" ")}</Fact>}
          </>
        )}
        <Fact label="Specification">
          {draft.spec.parts.length} parts ({[...new Set(draft.spec.parts.map((p) => p.shape))].join(", ")}); approved shapes and materials only, built by
          the project&apos;s own generator. No code from the language model is run.
        </Fact>
      </dl>
    </section>
  );
}
