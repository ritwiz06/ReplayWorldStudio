// The conversation beside the world (UX-03): short cards instead of instructions. Each card is a
// progress line, a question (with clickable choices or a small form), a proposal (Apply or
// Cancel), a result (with Undo) or a reason why something cannot be done. Details - measurements,
// assumptions, evidence - are one click away under each card. While a drawing is being reviewed,
// a live card asks only the corrections the world actually needs.
import type { Project } from "@replay-world/contracts";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type SuggestionId, SUGGESTION_TEXT } from "../chat/context";
import type { CardChoice, ChatController, Entry, LookOption, LookRow, LookView, ModelUnit, ModelView, PlanRow, PlanView, UpAxis } from "../chat/useChat";
import { nameOf } from "../chat/context";
import type { ReviewCorrection } from "../drawing/review";
import { reviewItems } from "../drawing/review";
import type { DrawingSource } from "../drawing/world";
import { symbolCandidates } from "../chat/context";

interface Props {
  project: Project | null;
  entries: Entry[];
  suggestions: SuggestionId[];
  busy: boolean;
  assist: { available: boolean; mode: "live" | "recorded" | "off" | "checking" | "unreachable" };
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onSend: (text: string) => void;
  onSuggest: (id: SuggestionId) => void;
  onAttach: (file: File) => void;
  onMove: (entryId: number, objectId: string, direction: "left" | "right" | "forward" | "back", metres: number) => void;
  onRoute: (entryId: number, fromId: string, toId: string, width: number, allowance: number) => void;
  onHighlight: (ids: string[]) => void;
  /** The drawing under review, when its review is open. */
  review: {
    source: DrawingSource;
    onCorrect: (c: ReviewCorrection) => string | null;
    onCorrectAll: (c: ReviewCorrection[]) => string | null;
    onPlan: (trace: boolean) => void;
    onSymbolsDone: () => void;
  } | null;
  /** The guided setup, when the conversation asked for it. */
  setup: ReactNode | null;
  fileInput: React.RefObject<HTMLInputElement | null>;
  /** The controller's plan actions (choices, forms, Apply, Cancel). */
  plans: Pick<ChatController, "planTarget" | "planMove" | "planRotate" | "planAsset" | "planNear" | "planSide" | "planClarify">;
  /** The appearance card's actions (UX-05). */
  looks: Pick<ChatController, "lookUse" | "lookKeep" | "lookBrowse" | "lookHover" | "lookCreate" | "lookUpload" | "lookPhoto">;
  /** The attached-model review's actions (ENR-01). */
  models: Pick<ChatController, "modelChoose" | "modelShow">;
}

const AI_WORDS = { live: "AI on · ASU Voyager", recorded: "Recorded answers (test)", off: "AI off · no key", checking: "Checking the AI…", unreachable: "AI status unknown · retrying" } as const;
const PLACEHOLDER = { checking: "Checking whether AI is available…", unreachable: "AI status unknown: use the suggestions", off: "Typing needs AI (off: no key)" } as const;

export function ChatPanel(props: Props) {
  const { project, entries, suggestions, busy, assist, collapsed, onCollapse, onSend, onSuggest, onAttach, review, setup, fileInput } = props;
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, review?.source, setup]);

  if (collapsed) {
    return (
      <button type="button" className="chat-open" data-testid="chat-open" onClick={() => onCollapse(false)} aria-label="Open the conversation">
        Ask
      </button>
    );
  }
  const send = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  return (
    <aside className="chat" aria-label="Conversation" data-testid="chat">
      <header className="chat-head">
        <strong>Assistant</strong>
        <span className={`chat-ai chat-ai-${assist.mode}`} data-testid="chat-ai" data-mode={assist.mode}>
          {AI_WORDS[assist.mode]}
        </span>
        <button type="button" className="icon-button" data-testid="chat-collapse" onClick={() => onCollapse(true)} aria-label="Hide the conversation" title="Hide the conversation">
          ⟩
        </button>
      </header>
      <div className="chat-list" ref={list} data-testid="chat-list" aria-live="polite">
        {entries.length === 0 && (
          <div className="chat-welcome" data-testid="chat-welcome">
            <p className="chat-welcome-title">Move something in a layout. See whether it still works, and what changes in a shift.</p>
          </div>
        )}
        {entries.map((e) => (e.role === "user" ? <UserLine key={e.id} entry={e} /> : <Card key={e.id} entry={e} project={project} props={props} />))}
        {review && <ReviewCard {...review} project={project} onHighlight={props.onHighlight} />}
        {setup && (
          <div className="chat-card chat-setup" data-testid="chat-setup">
            {setup}
          </div>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="chat-suggestions" data-testid="chat-suggestions">
          {suggestions.map((id) => (
            <button key={id} type="button" className="chip" data-testid={`chat-suggest-${id}`} onClick={() => onSuggest(id)} disabled={busy}>
              {SUGGESTION_TEXT[id]}
            </button>
          ))}
        </div>
      )}
      <div className="chat-composer">
        <button type="button" className="icon-button chat-attach" data-testid="chat-attach" onClick={() => fileInput.current?.click()} aria-label="Attach a plan or project" title="Attach a plan (DXF, PDF, PNG, JPEG) or a project">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M16.5 6.5 8.4 14.6a2 2 0 1 0 2.8 2.8l8.1-8.1a4 4 0 0 0-5.7-5.7L5.5 11.7a6 6 0 0 0 8.5 8.5l6.2-6.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg,.json,.zip,.glb"
          data-testid="chat-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onAttach(file);
          }}
        />
        <textarea
          rows={2}
          value={text}
          data-testid="chat-input"
          disabled={!assist.available}
          placeholder={assist.available ? "Ask about this world or tell it what to change" : PLACEHOLDER[assist.mode as keyof typeof PLACEHOLDER]}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
        />
        <button type="button" className="button button-primary chat-send" data-testid="chat-send" onClick={send} disabled={!assist.available || !text.trim() || busy}>
          Send
        </button>
      </div>
    </aside>
  );
}

function UserLine({ entry }: { entry: Entry }) {
  return (
    <div className="chat-user" data-testid="chat-user">
      {entry.text}
    </div>
  );
}

function Card({ entry, project, props }: { entry: Entry; project: Project | null; props: Props }) {
  const live = !entry.closed;
  return (
    <div
      className={`chat-card tone-${entry.tone}${entry.closed ? " closed" : ""}`}
      data-testid="chat-card"
      data-kind={entry.kind}
      data-interpret-ms={entry.timing?.interpretMs}
      data-provider-ms={entry.timing?.providerMs}
      data-prepare-ms={entry.timing?.prepareMs}
      data-execute-ms={entry.timing?.executeMs}
    >
      {entry.via && (
        <span className="chat-via" title={entry.via === "live" ? "Interpreted by the language model; the app checked and performed it" : "A recorded answer replayed offline (not live AI)"}>
          {entry.via === "live" ? "AI interpreted" : "recorded answer"}
        </span>
      )}
      <p className="chat-text">{entry.text}</p>
      {entry.lines && entry.lines.length > 0 && (
        <ul className="chat-lines">
          {entry.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {entry.plan && entry.plan.rows.length > 0 && project && <PlanRows plan={entry.plan} project={project} props={props} />}
      {entry.look && entry.look.rows.length > 0 && <LookRows look={entry.look} actions={props.looks} />}
      {entry.model && <ModelReview view={entry.model} actions={props.models} />}
      {live && entry.choices && entry.choices.length > 0 && <Choices choices={entry.choices} onHighlight={props.onHighlight} />}
      {live && entry.form?.kind === "move" && project && <MoveForm entry={entry} objectId={entry.form.objectId} project={project} onMove={props.onMove} onHighlight={props.onHighlight} />}
      {live && entry.form?.kind === "route" && project && <RouteForm entry={entry} form={entry.form} project={project} onRoute={props.onRoute} />}
      {live && entry.form?.kind === "unit" && (
        <div className="chat-buttons">
          {entry.form.units.map((u) => (
            <button key={u.unit} type="button" className="button button-small" data-testid={`chat-unit-${u.unit}`} onClick={() => entry.form?.kind === "unit" && entry.form.choose(u.unit)}>
              {u.label}
            </button>
          ))}
        </div>
      )}
      {entry.details && entry.details.length > 0 && (
        <details className="chat-details">
          <summary>Details</summary>
          <ul>
            {entry.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      {live && entry.buttons && entry.buttons.length > 0 && (
        <div className="chat-buttons">
          {entry.buttons.map((b) => (
            <button key={b.testId} type="button" className={`button button-small${b.primary ? " button-primary" : ""}`} data-testid={b.testId} onClick={b.run}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MARK: Record<PlanRow["status"], string> = { ready: "○", needs: "?", running: "…", done: "✓", failed: "✗", skipped: "–", cancelled: "–", unsupported: "✗" };

/** A plan's steps, each with its status, and in review the one answer it still needs. */
function PlanRows({ plan, project, props }: { plan: PlanView; project: Project; props: Props }) {
  return (
    <ol className="plan-rows" data-testid="plan-rows">
      {plan.rows.map((row, i) => (
        <li key={`${row.index}-${i}`} className={`plan-row plan-${row.status}`} data-testid={`plan-row-${i}`} data-status={row.status}>
          <span className="plan-mark" aria-hidden="true">
            {MARK[row.status]}
          </span>
          <span className="plan-label">
            {row.label}
            {row.note && <span className="plan-note"> · {row.note}</span>}
          </span>
          {row.need && <PlanNeed plan={plan} row={row} project={project} props={props} />}
        </li>
      ))}
    </ol>
  );
}

function PlanNeed({ plan, row, project, props }: { plan: PlanView; row: PlanRow; project: Project; props: Props }) {
  const need = row.need!;
  const p = props.plans;
  const [metres, setMetres] = useState("1");
  const [degrees, setDegrees] = useState("90");
  const id = `plan-${plan.id}-${row.index}`;
  return (
    <div className="plan-need" data-testid={`plan-need-${row.index}`} data-kind={need.kind}>
      <p className="small">{need.question}</p>
      {(need.kind === "target" || need.kind === "near") && (
        <div className="chat-buttons">
          {need.candidates.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              className="button button-small"
              data-testid={`chat-choice-${c.id}`}
              onMouseEnter={() => props.onHighlight([c.id])}
              onFocus={() => props.onHighlight([c.id])}
              onClick={() => (need.kind === "target" ? p.planTarget(plan.id, row.index, c.id) : p.planNear(plan.id, row.index, c.id))}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {need.kind === "move" && (
        <div className="chat-form">
          <label className="chat-field">
            Distance <input type="number" min="0.01" step="0.1" value={metres} data-testid={`${id}-distance`} onChange={(e) => setMetres(e.target.value)} /> m
          </label>
          <div className="chat-buttons">
            {DIRECTIONS.map(({ d, label }) => (
              <button key={d} type="button" className="button button-small" data-testid={`chat-move-${d}`} disabled={!(Number(metres) > 0)} onClick={() => p.planMove(plan.id, row.index, d, Number(metres))}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {need.kind === "rotate" && (
        <div className="chat-form">
          <label className="chat-field">
            Angle <input type="number" min="1" max="360" step="5" value={degrees} data-testid={`${id}-angle`} onChange={(e) => setDegrees(e.target.value)} /> °
          </label>
          <div className="chat-buttons">
            <button type="button" className="button button-small" data-testid="chat-turn-clockwise" onClick={() => p.planRotate(plan.id, row.index, "clockwise", Number(degrees))}>
              ↻ Clockwise
            </button>
            <button type="button" className="button button-small" data-testid="chat-turn-counterclockwise" onClick={() => p.planRotate(plan.id, row.index, "counterclockwise", Number(degrees))}>
              ↺ Counterclockwise
            </button>
          </div>
        </div>
      )}
      {need.kind === "asset" && (
        <div className="chat-buttons">
          {need.suggestion && (
            <button type="button" className="button button-small button-primary" data-testid="chat-asset-use" onClick={() => p.planAsset(plan.id, row.index, "use")}>
              Use “{need.suggestion.label}”
            </button>
          )}
          <button type="button" className="button button-small" data-testid="chat-asset-describe" onClick={() => p.planAsset(plan.id, row.index, "describe")}>
            Describe a new object…
          </button>
          <button type="button" className="button button-small" data-testid="chat-asset-builder" onClick={() => p.planAsset(plan.id, row.index, "builder")}>
            Build it by hand…
          </button>
        </div>
      )}
      {need.kind === "side" && (
        <div className="chat-buttons">
          {(["left", "right", "back", "front"] as const).map((side) => (
            <button key={side} type="button" className="button button-small" data-testid={`chat-side-${side}`} onClick={() => p.planSide(plan.id, row.index, side)}>
              {{ left: "← Left", right: "Right →", back: "↑ Behind", front: "↓ In front" }[side]}
            </button>
          ))}
        </div>
      )}
      {need.kind === "clarify" && <ClarifyForm onAnswer={(text) => p.planClarify(plan.id, text)} />}
      {project === null && null}
    </div>
  );
}

/** Reviewing models for imported equipment (UX-05): suggested, to choose, and the rest folded
 * away; each row highlights its object, and an option draws the object with it while hovered. */
function LookRows({ look, actions }: { look: LookView; actions: Props["looks"] }) {
  const first = look.rows.filter((r) => r.status !== "none" && r.status !== "kept");
  const rest = look.rows.filter((r) => r.status === "none" || r.status === "kept");
  const row = (r: LookRow) => <LookRowView key={r.objectId} look={look} row={r} actions={actions} />;
  return (
    <div className="look-rows" data-testid="look-rows" onMouseLeave={() => actions.lookHover(look.id, null, null)}>
      {first.map(row)}
      {rest.length > 0 && look.phase === "review" && (
        <details className="chat-details look-rest" data-testid="look-rest">
          <summary>
            Other equipment ({rest.length}): no catalog model of that kind{rest.some((r) => r.status === "kept") ? ", or kept" : ""}
          </summary>
          {rest.map(row)}
        </details>
      )}
    </div>
  );
}

function Still({ option }: { option: LookOption }) {
  return option.preview ? <img className="look-still" src={option.preview} alt="" width={56} height={42} /> : <span className="look-still look-still-none" aria-hidden="true" />;
}

function LookOptionView({ option, brief = false }: { option: LookOption; brief?: boolean }) {
  return (
    <div className="look-option-body">
      <Still option={option} />
      <div>
        <strong>{option.name}</strong>
        {option.generic && <span className="look-tag">generic model</span>}
        <p className="small">{option.reason}</p>
        {brief ? (
          <p className="small look-warn">{option.summary}</p>
        ) : (
          option.warnings.map((w) => (
            <p key={w} className="small look-warn">
              {w}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function LookRowView({ look, row, actions }: { look: LookView; row: LookRow; actions: Props["looks"] }) {
  const review = look.phase === "review";
  const id = row.objectId;
  const chosen = row.options.find((o) => o.assetId === row.chosen) ?? null;
  const shown = chosen ?? row.suggestion;
  const hover = (assetId: string | null) => review && actions.lookHover(look.id, id, assetId);
  return (
    <div className={`look-row look-${row.status}`} data-testid={`look-row-${id}`} data-status={row.status} onMouseEnter={() => hover(shown?.assetId ?? null)} onFocus={() => hover(shown?.assetId ?? null)}>
      <div className="look-head">
        <strong>{row.label}</strong>
        <span className="look-state">{{ suggested: "suggested", ask: "your choice", none: "no catalog model", chosen: "✓ chosen", kept: "kept as it is", made: "new model applied" }[row.status]}</span>
      </div>
      {shown && row.status !== "made" && <LookOptionView option={shown} />}
      {row.question && !chosen && row.status !== "kept" && row.status !== "made" && <p className="small">{row.question}</p>}
      {row.note && <p className="small muted" data-testid={`look-note-${id}`}>{row.note}</p>}
      {review && row.status !== "made" && (
        <div className="chat-buttons">
          {row.status === "suggested" && (
            <button type="button" className="button button-small button-primary" data-testid={`look-use-${id}`} onClick={() => actions.lookUse(look.id, id, row.suggestion!.assetId)}>
              Use this model
            </button>
          )}
          {(row.status !== "none" || row.options.length > 0) && (
            <button type="button" className="button button-small" data-testid={`look-other-${id}`} aria-expanded={row.browsing} onClick={() => actions.lookBrowse(look.id, id)}>
              {row.status === "ask" ? "Choose a model" : "Choose another"}
            </button>
          )}
          {row.status === "none" && (
            <>
              <button type="button" className="button button-small" data-testid={`look-describe-${id}`} onClick={() => actions.lookCreate(look.id, id, "describe")}>
                Describe this equipment
              </button>
              <button type="button" className="button button-small" data-testid={`look-build-${id}`} onClick={() => actions.lookCreate(look.id, id, "builder")}>
                Build it manually
              </button>
            </>
          )}
          <button type="button" className="button button-small" data-testid={`look-upload-${id}`} onClick={() => actions.lookUpload(id)}>
            Upload a 3D model…
          </button>
          <button type="button" className="button button-small" data-testid={`look-photo-${id}`} onClick={() => actions.lookPhoto(id)}>
            Improve from photo…
          </button>
          {row.status !== "kept" && (
            <button type="button" className="button button-small" data-testid={`look-keep-${id}`} onClick={() => actions.lookKeep(look.id, id)}>
              {row.status === "none" ? "Keep the current stand-in" : "Keep current appearance"}
            </button>
          )}
        </div>
      )}
      {review && row.browsing && <LookBrowse look={look} row={row} actions={actions} />}
    </div>
  );
}

/** Every catalog model that can be fitted to this object, searchable, each previewed on it. */
function LookBrowse({ look, row, actions }: { look: LookView; row: LookRow; actions: Props["looks"] }) {
  const [query, setQuery] = useState("");
  const found = row.options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="look-browse" data-testid={`look-browse-${row.objectId}`}>
      <input type="search" value={query} placeholder="Search the catalog" aria-label={`Search models for ${row.label}`} data-testid={`look-search-${row.objectId}`} onChange={(e) => setQuery(e.target.value)} />
      {found.length === 0 && <p className="small muted">No catalog model{query ? " with that name" : ""} can be fitted to its recorded size.</p>}
      {found.map((o) => (
        <div key={o.assetId} className="look-option" onMouseEnter={() => actions.lookHover(look.id, row.objectId, o.assetId)} onFocus={() => actions.lookHover(look.id, row.objectId, o.assetId)}>
          <LookOptionView option={o} brief />
          <button type="button" className="button button-small" data-testid={`look-option-${row.objectId}-${o.assetId}`} onClick={() => actions.lookUse(look.id, row.objectId, o.assetId)}>
            Use
          </button>
        </div>
      ))}
    </div>
  );
}

const UP_LABELS: Record<string, string> = { "+Y": "Y up (glTF)", "+Z": "Z up (CAD)", "-Z": "−Z up", "-Y": "−Y up", "+X": "X up", "-X": "−X up" };
const triple = (t: [number, number, number]) => `${t[0].toFixed(2)} × ${t[2].toFixed(2)} m, ${t[1].toFixed(2)} m high`;

/** An attached .glb under review for one object (ENR-01): is it the right object, which way
 * does it face, does it fit the recorded space? Problems sit beside Apply; the rest is folded. */
function ModelReview({ view, actions }: { view: ModelView; actions: Props["models"] }) {
  if (view.phase !== "review") return null;
  const id = view.id;
  return (
    <div className="model-review" data-testid="model-review" data-busy={view.busy ? "true" : "false"}>
      <p className="small">
        For <strong data-testid="model-target">{view.label}</strong> (highlighted). Only how it is drawn changes.
      </p>
      <div className="chat-buttons" role="group" aria-label="Show">
        <button type="button" className={`button button-small${view.showing === "proposed" ? " button-primary" : ""}`} aria-pressed={view.showing === "proposed"} data-testid="model-show-proposed" onClick={() => actions.modelShow(id, "proposed")}>
          Proposed look
        </button>
        <button type="button" className={`button button-small${view.showing === "current" ? " button-primary" : ""}`} aria-pressed={view.showing === "current"} data-testid="model-show-current" onClick={() => actions.modelShow(id, "current")}>
          Current look
        </button>
      </div>
      <div className="model-row">
        <span className="small muted">Facing</span>
        <button type="button" className="button button-small" data-testid="model-turn-left" aria-label="Turn the model a quarter left" onClick={() => actions.modelChoose(id, { turn: -1 })}>
          ↺ Turn
        </button>
        <button type="button" className="button button-small" data-testid="model-turn-right" aria-label="Turn the model a quarter right" onClick={() => actions.modelChoose(id, { turn: 1 })}>
          Turn ↻
        </button>
        <select aria-label="Which axis of the file is up" data-testid="model-up" value={view.up} onChange={(e) => actions.modelChoose(id, { up: e.target.value as UpAxis })}>
          {Object.entries(UP_LABELS).map(([axis, label]) => (
            <option key={axis} value={axis}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <p className="small muted">Its front should face the object's front: toward the bottom of the plan in Top view.</p>
      <div className="model-row" role="radiogroup" aria-label="Fit">
        <label className="small">
          <input type="radio" name={`fit-${id}`} checked={view.fit === "contain"} data-testid="model-fit-contain" onChange={() => actions.modelChoose(id, { fit: "contain" })} /> Keep proportions, inside the recorded space
        </label>
        <label className="small">
          <input type="radio" name={`fit-${id}`} checked={view.fit === "scale_to_dimensions"} data-testid="model-fit-stretch" onChange={() => actions.modelChoose(id, { fit: "scale_to_dimensions" })} /> Stretch to fill it (distorts)
        </label>
      </div>
      <table className="model-sizes small" data-testid="model-sizes">
        <tbody>
          <tr>
            <th scope="row">Recorded object</th>
            <td>
              {triple(view.recorded)} <span className="muted">({view.recordedNote}; unchanged)</span>
            </td>
          </tr>
          <tr>
            <th scope="row">Model file</th>
            <td>{view.model ? triple(view.model) : "…"}</td>
          </tr>
          <tr>
            <th scope="row">Drawn as</th>
            <td>{view.drawn ? triple(view.drawn) : "…"}</td>
          </tr>
        </tbody>
      </table>
      {view.scaleHint && (
        <div className="model-row">
          <span className="small muted">File unit</span>
          <select aria-label="The unit the file was written in" data-testid="model-unit" value={view.unit} onChange={(e) => actions.modelChoose(id, { unit: e.target.value as ModelUnit })}>
            <option value="m">metres (glTF)</option>
            <option value="cm">centimetres</option>
            <option value="mm">millimetres</option>
            <option value="in">inches</option>
            <option value="ft">feet</option>
          </select>
        </div>
      )}
      {view.warnings.length > 0 && (
        <ul className="model-warnings" data-testid="model-warnings">
          {view.warnings.map((w) => (
            <li key={w} className="small look-warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      <details className="chat-details" data-testid="model-details">
        <summary>Details</summary>
        <ul>
          {view.details.map((d) => (
            <li key={d} className="small">
              {d}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** The person says what they meant; the request is then read again with their words. */
function ClarifyForm({ onAnswer }: { onAnswer: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="chat-form-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onAnswer(text);
      }}
    >
      <input type="text" value={text} placeholder="What you meant" aria-label="What you meant" data-testid="chat-clarify-text" onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="button button-small button-primary" data-testid="chat-clarify-send" disabled={!text.trim()}>
        Ask again
      </button>
    </form>
  );
}

function Choices({ choices, onHighlight }: { choices: CardChoice[]; onHighlight: (ids: string[]) => void }) {
  return (
    <div className="chat-buttons">
      {choices.map((c) => (
        <button
          key={c.testId}
          type="button"
          className="button button-small"
          data-testid={c.testId}
          onMouseEnter={() => c.objectId && onHighlight([c.objectId])}
          onFocus={() => c.objectId && onHighlight([c.objectId])}
          onClick={c.run}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

const DIRECTIONS = [
  { d: "left", label: "← Left" },
  { d: "right", label: "Right →" },
  { d: "back", label: "↑ Back" },
  { d: "forward", label: "↓ Forward" },
] as const;

function MoveForm({ entry, objectId, project, onMove, onHighlight }: { entry: Entry; objectId: string | null; project: Project; onMove: Props["onMove"]; onHighlight: Props["onHighlight"] }) {
  const machines = useMemo(() => project.scene.objects.filter((o) => o.kind === "equipment"), [project]);
  const [target, setTarget] = useState(objectId ?? "");
  const [metres, setMetres] = useState("1");
  const value = Number(metres);
  const ok = target !== "" && Number.isFinite(value) && value > 0 && value <= 100;
  return (
    <div className="chat-form">
      {!objectId && (
        <label className="chat-field">
          Machine
          <select
            value={target}
            data-testid="chat-move-object"
            onChange={(e) => {
              setTarget(e.target.value);
              if (e.target.value) onHighlight([e.target.value]);
            }}
          >
            <option value="">choose…</option>
            {machines.map((o) => (
              <option key={o.id} value={o.id}>
                {nameOf(project, o.id)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="chat-field">
        Distance{" "}
        <input type="number" min="0.01" step="0.1" value={metres} data-testid="chat-move-distance" onChange={(e) => setMetres(e.target.value)} /> m
      </label>
      <div className="chat-buttons">
        {DIRECTIONS.map(({ d, label }) => (
          <button key={d} type="button" className="button button-small" data-testid={`chat-move-${d}`} disabled={!ok} onClick={() => onMove(entry.id, target, d, value)}>
            {label}
          </button>
        ))}
      </div>
      <p className="small muted">Directions as seen from above (the Top view). You'll see the change before it is applied.</p>
    </div>
  );
}

function RouteForm({ entry, form, project, onRoute }: { entry: Entry; form: { fromId: string | null; toId: string | null; width: string; allowance: string }; project: Project; onRoute: Props["onRoute"] }) {
  const objects = useMemo(() => project.scene.objects.filter((o) => o.kind === "equipment" || o.kind === "structure"), [project]);
  const [from, setFrom] = useState(form.fromId ?? "");
  const [to, setTo] = useState(form.toId ?? "");
  const [width, setWidth] = useState(form.width);
  const [allowance, setAllowance] = useState(form.allowance);
  const ok = from && to && from !== to && Number(width) > 0 && Number(allowance) >= 0;
  return (
    <div className="chat-form">
      <div className="chat-row">
        <label className="chat-field">
          From
          <select value={from} data-testid="chat-route-from" onChange={(e) => setFrom(e.target.value)}>
            <option value="">choose…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {nameOf(project, o.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="chat-field">
          To
          <select value={to} data-testid="chat-route-to" onChange={(e) => setTo(e.target.value)}>
            <option value="">choose…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {nameOf(project, o.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="chat-row">
        <label className="chat-field">
          Item width <input type="number" min="0.05" step="0.05" value={width} placeholder="e.g. 1.2" data-testid="chat-route-width" onChange={(e) => setWidth(e.target.value)} /> m
        </label>
        <label className="chat-field">
          Spare each side <input type="number" min="0" step="0.05" value={allowance} data-testid="chat-route-allowance" onChange={(e) => setAllowance(e.target.value)} /> m
        </label>
      </div>
      <button type="button" className="button button-small button-primary" data-testid="chat-route-check" disabled={!ok} onClick={() => onRoute(entry.id, from, to, Number(width), Number(allowance))}>
        Check the route
      </button>
    </div>
  );
}

const ITEM_NAME: Record<string, string> = { floor: "Floor", scale: "Scale", objects: "Objects", omissions: "Left out" };

/** The review, as the conversation asks it (UX-04): one line of summary, the next correction
 * that needs an answer (shown in the world), and what is already answered, folded but still
 * changeable. Nothing is accepted for the person. */
function ReviewCard({ source, onCorrect, onCorrectAll, onPlan, onSymbolsDone, onHighlight, project }: NonNullable<Props["review"]> & { project: Project | null; onHighlight: Props["onHighlight"] }) {
  const [problem, setProblem] = useState<string | null>(null);
  const loose = symbolCandidates(source);
  const [symbols, setSymbols] = useState<Set<string>>(() => new Set(loose.filter((c) => c.likely).map((c) => c.layer)));
  const items = reviewItems(source);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const next = open[0] ?? null;
  const review = source.drawing.review;
  const apply = (c: ReviewCorrection) => setProblem(onCorrect(c));
  const proposed = review.objects.filter((o) => o.status === "proposed");
  const names = source.drawing.objects
    .filter((d) => proposed.some((o) => o.drawn_id === d.id))
    .slice(0, 4)
    .map((d) => d.label);
  const noOutline = review.floor.drawn_id === null;
  const floorLayer = source.drawing.objects.find((d) => d.id === review.floor.drawn_id)?.refs[0]?.layer;
  const floorSize = items.find((i) => i.id === "floor")?.detail.split(", ").at(-1) ?? "";
  const plain = (text: string) => text.replace(/ \(the drawing's own unit, \$INSUNITS\)/, " (from the drawing)").replace(/\$INSUNITS/g, "the drawing's unit");
  const likely = loose.some((c) => c.likely);
  // Show what is being asked about in the world: the floor, or the objects still to accept.
  const floorId = review.floor.object_id;
  const ask = next?.id ?? (likely ? "symbols" : null);
  const objectIds = proposed.map((o) => source.drawing.objects.find((d) => d.id === o.drawn_id)?.object_id).filter((x): x is string => Boolean(x));
  const highlight = ask === "floor" && floorId ? [floorId] : ask === "objects" ? objectIds : [];
  const key = highlight.join(",");
  useEffect(() => {
    if (key) onHighlight(key.split(","));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const what = (c: (typeof loose)[number]) => [c.lines && `${c.lines} loose line${c.lines === 1 ? "" : "s"}`, ...Object.entries(c.shapes).map(([e, n]) => `${n} ${e.toLowerCase()}${n === 1 ? "" : "s"}`)].filter(Boolean).join(", ");
  return (
    <div className="chat-card tone-question chat-review" data-testid="chat-review">
      <p className="chat-text">
        {source.filename}: {review.objects.length} outlines · {done.length} of {items.length} answered
      </p>
      {done.length > 0 && (
        <details className="chat-details review-done" data-testid="chat-review-done">
          <summary>Answered ({done.map((i) => ITEM_NAME[i.id]).join(", ")})</summary>
          <ul>
            {done.map((i) => (
              <li key={i.id}>
                {ITEM_NAME[i.id]}: {i.title.toLowerCase()} ·{" "}
                <button type="button" className="link-button" data-testid={`chat-review-change-${i.id}`} onClick={() => onPlan(false)}>
                  change
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {next && (
        <div className="chat-review-item" data-testid={`chat-review-${next.id}`}>
          {next.id === "floor" && (
            <>
              <p>{noOutline ? "The drawing has no closed floor outline, so routes can't be checked yet. Trace the floor's corners on the plan." : `Is this the floor? The outline${floorLayer ? ` on layer ${floorLayer}` : ""}, ${floorSize} (shown in the world).`}</p>
              <div className="chat-buttons">
                {!noOutline && (
                  <button type="button" className="button button-small button-primary" data-testid="chat-floor-accept" onClick={() => apply({ kind: "accept_floor" })}>
                    Looks right
                  </button>
                )}
                <button type="button" className={`button button-small${noOutline ? " button-primary" : ""}`} data-testid="chat-floor-trace" onClick={() => onPlan(true)}>
                  Trace it on the plan
                </button>
              </div>
            </>
          )}
          {next.id === "scale" && (
            <>
              <p>Is the scale right? {plain(next.detail)}.</p>
              <div className="chat-buttons">
                {review.scale.unit !== "px" && (
                  <button type="button" className="button button-small button-primary" data-testid="chat-scale-accept" onClick={() => apply({ kind: "unit", unit: review.scale.unit as "mm" })}>
                    Looks right
                  </button>
                )}
                <button type="button" className="button button-small" data-testid="chat-scale-other" onClick={() => onPlan(false)}>
                  Another unit or a known length…
                </button>
              </div>
            </>
          )}
          {next.id === "objects" && (
            <>
              <p>
                {proposed.length} object{proposed.length === 1 ? "" : "s"} found (highlighted){names.length ? `: ${names.join(", ")}${proposed.length > names.length ? ", …" : ""}` : ""}. Footprints come from the drawing; heights are assumed for display.
              </p>
              <div className="chat-buttons">
                <button type="button" className="button button-small button-primary" data-testid="chat-objects-accept" onClick={() => apply({ kind: "accept_remaining" })}>
                  Accept them
                </button>
                <button type="button" className="button button-small" data-testid="chat-objects-check" onClick={() => onPlan(false)}>
                  Check one by one…
                </button>
              </div>
            </>
          )}
          {next.id === "omissions" && (
            <>
              <p>Not taken from the drawing: {next.detail}.</p>
              <div className="chat-buttons">
                <button type="button" className="button button-small button-primary" data-testid="chat-omissions-accept" onClick={() => apply({ kind: "accept_omissions" })}>
                  Understood
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!next && likely && (
        <div className="chat-review-item" data-testid="chat-review-symbols">
          <p>Loose lines and left-out shapes count as possible obstacles, so routes past them can't be determined. Which layers hold only drawing symbols? Closed outlines on them stay objects.</p>
          <div className="chat-symbols">
            {loose.map((c) => (
              <label key={c.layer} className={`check-row small${c.physical ? " symbol-physical" : ""}`} title={c.physical ? "May hold real walls or structure: excluding its loose lines lets routes pass through them." : undefined}>
                <input
                  type="checkbox"
                  data-testid={`chat-symbol-${c.layer}`}
                  checked={symbols.has(c.layer)}
                  onChange={(e) =>
                    setSymbols((set) => {
                      const next2 = new Set(set);
                      if (e.target.checked) next2.add(c.layer);
                      else next2.delete(c.layer);
                      return next2;
                    })
                  }
                />{" "}
                <strong>{c.layer}</strong> <span className="muted">({what(c)})</span>
                {c.physical && <span className="symbol-warn"> · may be walls</span>}
              </label>
            ))}
          </div>
          {[...symbols].some((l) => loose.find((c) => c.layer === l)?.physical) && (
            <p className="small status-warn" data-testid="chat-symbols-warning">
              A layer that may hold walls is ticked: its loose lines would stop blocking routes. Tick it only if those lines are wall fill or notes, not walls.
            </p>
          )}
          <div className="chat-buttons">
            <button
              type="button"
              className="button button-small"
              data-testid="chat-symbols-apply"
              disabled={symbols.size === 0}
              onClick={() => {
                const refused = onCorrectAll([...symbols].map((layer) => ({ kind: "symbols", layer, symbols: true })));
                if (refused) return setProblem(refused);
                setSymbols(new Set());
                onSymbolsDone();
              }}
            >
              Treat {symbols.size || "these"} as drawing symbols
            </button>
            <button type="button" className="button button-small" data-testid="chat-symbols-none" onClick={onSymbolsDone}>
              They're real things
            </button>
          </div>
        </div>
      )}
      {problem && (
        <p className="small status-error" role="alert">
          {problem}
        </p>
      )}
      {project === null && null}
    </div>
  );
}
