// Change an object with words, one bounded edit at a time ("move the selected cabinet 1 metre
// left"). The request and a short scene summary go to the language model; its typed answer is
// turned into an exact command and checked by the command engine, and the user sees the exact
// values before anything changes. Ambiguous requests come back as a question; a rejected change
// leaves the project as it was.
import type { EditProposalResult, Project } from "@replay-world/contracts";
import { useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { buildEditContext, type ResolvedEdit, resolveIntent } from "../assist/editIntent";

type State =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "proposal"; result: EditProposalResult; edit: ResolvedEdit }
  | { kind: "question"; result: EditProposalResult }
  | { kind: "refused"; title: string; message: string; result: EditProposalResult | null }
  | { kind: "applied"; summary: string };

interface Props {
  client: ApiClient;
  project: Project;
  selectedId: string | null;
  available: boolean;
  /** Why assistance is off, or where requests go. */
  note: string;
  /** Apply the resolved command; returns why it was not applied, or null. */
  onApply: (edit: ResolvedEdit) => string | null;
  onSelect: (id: string) => void;
}

export function ChangeBar({ client, project, selectedId, available, note, onApply, onSelect }: Props) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [details, setDetails] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const names = new Map(project.scene.objects.map((o) => [o.id, o.name]));

  async function ask(request: string, selection: string | null) {
    const trimmed = request.trim();
    if (trimmed.length < 3) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    // The change is prepared for this revision; if the scene changes before it is applied, the
    // command engine refuses it as a conflict.
    const baseRevision = project.scene.revision;
    setDetails(false);
    setState({ kind: "waiting" });
    let response;
    try {
      response = await client.proposeEdit({ request: trimmed, context: buildEditContext(project, selection) }, controller.signal);
    } catch {
      setState({ kind: "idle" });
      return;
    }
    if (!response.ok) {
      setState({ kind: "refused", title: "No proposal", message: response.error.message, result: null });
      return;
    }
    const result = response.value;
    if (result.outcome === "clarification") return setState({ kind: "question", result });
    if (result.outcome === "unsupported" || !result.intent) {
      return setState({ kind: "refused", title: "Not supported", message: result.message ?? "That change is not supported.", result });
    }
    const resolution = resolveIntent(project, result.intent, baseRevision);
    setState(
      resolution.ok
        ? { kind: "proposal", result, edit: resolution.edit }
        : { kind: "refused", title: "This change cannot be applied", message: `${resolution.message} Nothing was changed.`, result },
    );
  }

  function apply(edit: ResolvedEdit, result: EditProposalResult) {
    const problem = onApply(edit);
    if (problem) setState({ kind: "refused", title: "Not applied", message: `${problem} Nothing was changed.`, result });
    else setState({ kind: "applied", summary: edit.summary });
  }

  const result = state.kind === "proposal" || state.kind === "question" || state.kind === "refused" ? state.result : null;

  return (
    <div className="change-bar" data-testid="change-bar">
      {state.kind !== "idle" && (
        <div className={`change-card change-${state.kind}`} role="status" data-testid="change-card">
          {state.kind === "waiting" && <p>Interpreting your request…</p>}
          {state.kind === "proposal" && (
            <>
              <p>
                <strong data-testid="change-summary">{state.edit.summary}</strong>
              </p>
              <ul className="change-values" data-testid="change-values">
                {state.edit.changes.map((c) => (
                  <li key={c} className="mono">
                    {c}
                  </li>
                ))}
              </ul>
              <div className="change-actions">
                <button type="button" className="button button-primary" data-testid="change-apply" onClick={() => apply(state.edit, state.result)}>
                  Apply
                </button>
                <button type="button" className="button" data-testid="change-cancel" onClick={() => setState({ kind: "idle" })}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {state.kind === "question" && (
            <>
              <p data-testid="change-question">{state.result.question}</p>
              {state.result.candidates.length > 0 && (
                <div className="change-actions">
                  {state.result.candidates.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="button button-small"
                      data-testid={`change-candidate-${id}`}
                      onClick={() => {
                        // Answer the question by selecting the object, then ask again about "it".
                        onSelect(id);
                        const next = `${text.trim()} (I mean the selected object, ${names.get(id) ?? id})`;
                        setText(next);
                        void ask(next, id);
                      }}
                    >
                      {names.get(id) ?? id}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {state.kind === "refused" && (
            <>
              <p>
                <strong>{state.title}.</strong> <span data-testid="change-refused">{state.message}</span>
              </p>
              <button type="button" className="button button-small" onClick={() => setState({ kind: "idle" })}>
                Dismiss
              </button>
            </>
          )}
          {state.kind === "applied" && (
            <p data-testid="change-applied">
              Applied: {state.summary}. Undo with <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd>.
            </p>
          )}
          {result && (
            <button type="button" className="link-button" aria-expanded={details} onClick={() => setDetails(!details)}>
              {details ? "Hide details" : "Details"}
            </button>
          )}
          {details && result && (
            <dl className="facts change-details" data-testid="change-details">
              <dt>Interpreted by</dt>
              <dd>
                {result.provider.service} · {result.provider.model} ·{" "}
                {result.provider.mode === "live" ? "live" : "recorded offline test answer (not live AI)"} ·{" "}
                {(result.provider.latency_ms / 1000).toFixed(1)} s
              </dd>
              {result.intent && (
                <>
                  <dt>Understood as</dt>
                  <dd className="mono">
                    {result.intent.action} {result.intent.target.object_ids[0]} ({result.intent.target.reference}: “{result.intent.target.phrase}”)
                    {result.intent.move && ` · ${result.intent.move.direction} ${result.intent.move.distance} ${result.intent.move.unit} (“${result.intent.move.quote}”)`}
                    {result.intent.rotate && ` · ${result.intent.rotate.direction} ${result.intent.rotate.angle_deg}° (“${result.intent.rotate.quote}”)`}
                  </dd>
                </>
              )}
              {result.checks.length > 0 && (
                <>
                  <dt>Checks</dt>
                  <dd>{result.checks.join(" ")}</dd>
                </>
              )}
              <dt>Directions</dt>
              <dd>As in the top view: left −X, right +X, back −Z (up the screen), forward +Z, up and down vertical.</dd>
            </dl>
          )}
        </div>
      )}
      <form
        className="change-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text, selectedId);
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={300}
          disabled={!available}
          placeholder={available ? "Describe a change, e.g. “move the selected cabinet 1 metre left”" : "Change with words: assistant not available"}
          aria-label="Describe a change"
          title={note}
          data-testid="change-input"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="button" disabled={!available || text.trim().length < 3 || state.kind === "waiting"} data-testid="change-submit">
          Propose
        </button>
      </form>
    </div>
  );
}
