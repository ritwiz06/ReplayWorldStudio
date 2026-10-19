// "Show the example" (REL-01): the sample hall's before/after, one step at a time, using the
// app's own commands and engine: run the shift as drawn, move Machine B into the aisle, run the
// same shift again, compare, then undo the move and run again. Every number shown is from a run
// made at that moment; nothing is prerecorded. The hall and its shift are synthetic.
export interface ExampleProgress {
  /** The next step to take (0-5; 5 when finished). */
  step: number;
  /** Event fingerprints of the first run and of the run after undo. */
  first: string | null;
  again: string | null;
}

interface Props {
  progress: ExampleProgress | null;
  /** Why the example cannot start now (the layout was changed by hand), or null. */
  blocked: string | null;
  onStart: () => void;
  onNext: () => void;
}

const EXAMPLE_STEPS = [
  { action: "Run the shift on the hall as drawn", done: "The line runs: workers carry batches from Rack A through the mixer and Machine B to packing." },
  { action: "Move Machine B into the aisle", done: "Machine B now stands in the aisle beside Rack A (one undoable move)." },
  { action: "Run the same shift again", done: "Same process, same seed, same engine: only the layout differs." },
  { action: "Compare with the original layout", done: "The comparison names the blocked route and why output changed." },
  { action: "Undo the move and run again", done: "Back to the layout as drawn." },
] as const;

export function ShowExample({ progress, blocked, onStart, onNext }: Props) {
  if (!progress) {
    return (
      <div className="show-example" data-testid="show-example">
        <p className="small">
          <span className="badge badge-example">Synthetic example</span> See what moving one machine does to a day&apos;s output, step by step, with real runs on this made-up hall.
        </p>
        {blocked && <p className="small status-warn">{blocked}</p>}
        <button type="button" className="button button-primary" data-testid="example-start" disabled={blocked !== null} onClick={onStart}>
          Show the example
        </button>
      </div>
    );
  }
  const finished = progress.step >= EXAMPLE_STEPS.length;
  return (
    <div className="show-example" data-testid="show-example" data-step={progress.step}>
      <p className="small">
        <span className="badge badge-example">Synthetic example</span> Results under the stated assumptions.
      </p>
      <ol className="example-steps">
        {EXAMPLE_STEPS.map((s, i) => (
          <li key={s.action} className={i < progress.step ? "done" : i === progress.step ? "current" : "pending"} data-testid={`example-step-${i}`}>
            <strong>{s.action}</strong>
            {i < progress.step && <div className="small muted">{s.done}</div>}
          </li>
        ))}
      </ol>
      {!finished && (
        <button type="button" className="button button-primary" data-testid="example-next" onClick={onNext}>
          {EXAMPLE_STEPS[progress.step]!.action}
        </button>
      )}
      {finished && progress.first && progress.again && (
        <p className={`small ${progress.first === progress.again ? "status-ok" : "status-error"}`} data-testid="example-result">
          {progress.first === progress.again
            ? `The original result again: the same events as the first run (fingerprint ${progress.again}).`
            : `The run after undo differs from the first (${progress.first} → ${progress.again}).`}
        </p>
      )}
    </div>
  );
}
