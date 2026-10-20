// The conversation beside the world (UX-03): short cards instead of instructions. Each card is a
// progress line, a question (with clickable choices or a small form), a proposal (Apply or
// Cancel), a result (with Undo) or a reason why something cannot be done. Details - measurements,
// assumptions, evidence - are one click away under each card. While a drawing is being reviewed,
// a live card asks only the corrections the world actually needs.
import type { Project } from "@replay-world/contracts";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type SuggestionId, SUGGESTION_TEXT } from "../chat/context";
import type { CardChoice, Entry } from "../chat/useChat";
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
            <p className="chat-welcome-title">Upload a plan. Ask what you want to change. See it happen in the world.</p>
          </div>
        )}
        {entries.map((e) => (e.role === "user" ? <UserLine key={e.id} entry={e} /> : <Card key={e.id} entry={e} project={project} props={props} />))}
        {review && <ReviewCard {...review} project={project} />}
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
          accept=".dxf,.dwg,.pdf,.png,.jpg,.jpeg,.json,.zip"
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
    <div className={`chat-card tone-${entry.tone}${entry.closed ? " closed" : ""}`} data-testid="chat-card" data-kind={entry.kind}>
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

/** The review, as the conversation asks it: only the open items, each with its usual answer. */
function ReviewCard({ source, onCorrect, onCorrectAll, onPlan, onSymbolsDone, project }: NonNullable<Props["review"]> & { project: Project | null }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<Set<string>>(() => new Set(symbolCandidates(source).filter((c) => c.likely).map((c) => c.layer)));
  const items = reviewItems(source).filter((i) => !i.done);
  const review = source.drawing.review;
  const apply = (c: ReviewCorrection) => setProblem(onCorrect(c));
  const loose = symbolCandidates(source);
  const proposed = review.objects.filter((o) => o.status === "proposed").length;
  const names = source.drawing.objects
    .filter((d) => review.objects.some((o) => o.drawn_id === d.id && o.status === "proposed"))
    .slice(0, 5)
    .map((d) => d.label);
  const noOutline = review.floor.drawn_id === null;
  // Plain words for the floor and scale: where the outline is, not its CAD entity.
  const floorLayer = source.drawing.objects.find((d) => d.id === review.floor.drawn_id)?.refs[0]?.layer;
  const floorSize = reviewItems(source).find((i) => i.id === "floor")?.detail.split(", ").at(-1) ?? "";
  const plain = (text: string) => text.replace(/ \(the drawing's own unit, \$INSUNITS\)/, " (from the drawing)").replace(/\$INSUNITS/g, "the drawing's unit");
  const likely = loose.some((c) => c.likely);
  return (
    <div className="chat-card tone-question chat-review" data-testid="chat-review">
      <p className="chat-text">{items.length ? `Before anything is checked, confirm what ${source.filename} shows:` : `One more thing about ${source.filename}:`}</p>
      {items.map((item) => (
        <div key={item.id} className="chat-review-item" data-testid={`chat-review-${item.id}`}>
          {item.id === "floor" && (
            <>
              <p>{noOutline ? "The drawing has no closed floor outline, so routes can't be checked yet. Trace the floor's corners on the plan." : `Floor: the outline${floorLayer ? ` on layer ${floorLayer}` : ""}, ${floorSize}.`}</p>
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
          {item.id === "scale" && (
            <>
              <p>Scale: {plain(item.detail)}.</p>
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
          {item.id === "objects" && (
            <>
              <p>
                {proposed} object{proposed === 1 ? "" : "s"} found in the drawing{names.length ? ` (${names.join(", ")}${proposed > names.length ? ", …" : ""})` : ""}. Footprints come from the drawing; heights are assumed for display.
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
          {item.id === "omissions" && (
            <>
              <p>Not taken from the drawing: {item.detail}.</p>
              <div className="chat-buttons">
                <button type="button" className="button button-small button-primary" data-testid="chat-omissions-accept" onClick={() => apply({ kind: "accept_omissions" })}>
                  Understood
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {likely && (
        <div className="chat-review-item" data-testid="chat-review-symbols">
          <p>Loose lines count as possible obstacles, so routes past them can't be determined. Which layers only hold drawing symbols (door swings, wall fill, notes)?</p>
          <div className="chat-symbols">
            {loose.map(({ layer }) => (
              <label key={layer} className="check-row small">
                <input
                  type="checkbox"
                  data-testid={`chat-symbol-${layer}`}
                  checked={symbols.has(layer)}
                  onChange={(e) =>
                    setSymbols((set) => {
                      const next = new Set(set);
                      if (e.target.checked) next.add(layer);
                      else next.delete(layer);
                      return next;
                    })
                  }
                />{" "}
                {layer}
              </label>
            ))}
          </div>
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
          </button>{" "}
          <button type="button" className="button button-small" data-testid="chat-symbols-none" onClick={onSymbolsDone}>
            They're real things
          </button>
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
