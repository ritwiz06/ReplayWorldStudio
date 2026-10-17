// The main screen's three actions (UX-01, ADR-049): upload a plan, change something, play or
// compare. Each is one click; the editor's detail (object list, catalog, inspector) stays where
// it is for whoever needs it. The step the person is on is highlighted.
interface Props {
  /** Which step comes next: no drawing yet, a draft not changed yet, or changes to look at. */
  stage: "upload" | "change" | "compare";
  hasDrawing: boolean;
  disabled: boolean;
  onUpload: () => void;
  onChange: () => void;
  onCompare: () => void;
}

export function JourneyPanel({ stage, hasDrawing, disabled, onUpload, onChange, onCompare }: Props) {
  const steps = [
    { id: "upload", n: 1, label: "Upload a plan", hint: "A DXF floor layout becomes a 3D draft.", onClick: onUpload },
    { id: "change", n: 2, label: "Change something", hint: "Select an object and drag it to move it.", onClick: onChange },
    {
      id: "compare",
      n: 3,
      label: "Play or compare",
      hint: hasDrawing ? "Walk through it and compare with the drawing." : "Walk through the scene.",
      onClick: onCompare,
    },
  ] as const;
  return (
    <section className="journey" aria-label="Main actions" data-testid="journey">
      {steps.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`journey-step${stage === s.id ? " current" : ""}`}
          aria-current={stage === s.id ? "step" : undefined}
          data-testid={`journey-${s.id}`}
          disabled={disabled}
          onClick={s.onClick}
        >
          <span className="journey-n" aria-hidden="true">
            {s.n}
          </span>
          <span className="journey-text">
            <strong>{s.label}</strong>
            <span>{s.hint}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
