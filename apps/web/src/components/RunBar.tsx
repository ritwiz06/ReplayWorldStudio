// The playback bar of "Run a day", over the 3D view in every camera mode (orbit, plan, walk):
// the shift clock, Play/Pause, Restart, speed and a timeline with the breaks marked. It only
// chooses which moment of the finished run is shown.
import type { Playback, Speed } from "../hooks/usePlayback";
import { SPEEDS } from "../hooks/usePlayback";
import { plural } from "../run/day";
import type { Replay } from "../run/replay";
import { clockText } from "../run/replay";

interface Props {
  playback: Playback;
  replay: Replay;
  startClockS: number;
  itemName: string;
  breaks: { name: string; startMs: number; durationMs: number }[];
  example: boolean;
  onDetails: () => void;
  onClose: () => void;
}

export function RunBar({ playback, replay, startClockS, itemName, breaks, example, onDetails, onClose }: Props) {
  const { t, durationMs, playing } = playback;
  const now = replay.frame(t);
  return (
    <div className="run-bar" role="region" aria-label="Run a day playback" data-testid="run-bar" data-t={Math.round(t)} data-playing={playing ? "true" : "false"} data-speed={playback.speed}>
      <span className="run-bar-title">
        Run a day{example && <span className="badge badge-example">example</span>}
      </span>
      <strong className="run-bar-clock" data-testid="run-bar-clock">
        {clockText(startClockS, t)}
      </strong>
      {playing ? (
        <button type="button" className="button button-small" data-testid="run-pause" onClick={playback.pause}>
          Pause
        </button>
      ) : (
        <button type="button" className="button button-small button-primary" data-testid="run-play" onClick={playback.play}>
          {t >= durationMs ? "Play again" : t > 0 ? "Play" : "Play the shift"}
        </button>
      )}
      <button type="button" className="button button-small" data-testid="run-restart" onClick={playback.restart} disabled={t === 0}>
        Restart
      </button>
      <label className="run-bar-speed">
        <span className="sr-only">Speed</span>
        <select data-testid="run-speed" value={playback.speed} onChange={(e) => playback.setSpeed(Number(e.target.value) as Speed)}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s === 1 ? "real time" : `${s}×`}
            </option>
          ))}
        </select>
      </label>
      <div className="run-bar-timeline">
        <input
          type="range"
          min={0}
          max={durationMs}
          step={1000}
          value={Math.round(t)}
          aria-label={`Shift time, ${clockText(startClockS, 0)} to ${clockText(startClockS, durationMs)}`}
          data-testid="run-timeline"
          onChange={(e) => playback.seek(Number(e.target.value))}
        />
        {breaks.map((b) => (
          <span key={b.name} className="run-bar-break" title={`${b.name} ${clockText(startClockS, b.startMs)}`} style={{ left: `${(b.startMs / durationMs) * 100}%`, width: `${(b.durationMs / durationMs) * 100}%` }} />
        ))}
      </div>
      <span className="run-bar-count" data-testid="run-bar-completed" data-completed={now.completed}>
        {now.completed} {plural(itemName)} done
      </span>
      <button type="button" className="link-button small" data-testid="run-details" onClick={onDetails}>
        Details
      </button>
      <button type="button" className="link-button small" data-testid="run-close" onClick={onClose} aria-label="Close the run">
        ✕
      </button>
    </div>
  );
}
