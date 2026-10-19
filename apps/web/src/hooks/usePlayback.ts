// The playback clock for "Run a day" (SIM-03): which moment of a finished run is shown. It only
// chooses a time; what happened at that time comes from the run's events, so pausing, changing
// speed, scrubbing or restarting can never change the result. The 3D overlay follows the clock on
// every animation frame; the panel and bar see it about ten times a second.
import { useEffect, useState, useSyncExternalStore } from "react";

export const SPEEDS = [1, 10, 30, 120, 600] as const;
export type Speed = (typeof SPEEDS)[number];

export interface PlaybackClock {
  /** The moment shown, in milliseconds from the shift start. */
  now(): number;
  playing(): boolean;
  /** Called whenever the moment shown changes. */
  subscribe(listener: () => void): () => void;
}

interface View {
  t: number;
  playing: boolean;
  speed: Speed;
}

class PlaybackStore implements PlaybackClock {
  private t = 0;
  private isPlaying = false;
  private speed: Speed = 30;
  private durationMs = 1;
  private key: string | null = null;
  private wall = 0;
  private shown = 0;
  private frameId = 0;
  private readonly frameListeners = new Set<() => void>();
  private readonly viewListeners = new Set<() => void>();
  view: View = { t: 0, playing: false, speed: 30 };

  now = () => this.t;
  playing = () => this.isPlaying;
  subscribe = (listener: () => void) => {
    this.frameListeners.add(listener);
    return () => void this.frameListeners.delete(listener);
  };
  subscribeView = (listener: () => void) => {
    this.viewListeners.add(listener);
    return () => void this.viewListeners.delete(listener);
  };
  getView = () => this.view;

  /** Show a run: from the shift start, playing at once if asked. A run already shown keeps its place. */
  load(key: string | null, durationMs: number, autoPlay: boolean) {
    if (key === this.key) return;
    this.key = key;
    this.durationMs = durationMs;
    this.t = 0;
    this.stop();
    if (key && autoPlay) this.play();
    else this.publish(true);
  }

  play = () => {
    if (this.t >= this.durationMs) this.t = 0;
    this.isPlaying = true;
    this.wall = 0;
    this.publish(true);
    cancelAnimationFrame(this.frameId);
    this.frameId = requestAnimationFrame(this.tick);
  };

  pause = () => {
    this.stop();
    this.publish(true);
  };

  restart = () => {
    this.t = 0;
    this.publish(true);
  };

  seek = (t: number) => {
    this.t = Math.max(0, Math.min(this.durationMs, t));
    this.publish(true);
  };

  setSpeed = (speed: Speed) => {
    this.speed = speed;
    this.publish(true);
  };

  dispose() {
    this.stop();
  }

  private stop() {
    this.isPlaying = false;
    cancelAnimationFrame(this.frameId);
  }

  private tick = (wall: number) => {
    const dt = this.wall ? wall - this.wall : 0;
    this.wall = wall;
    this.t = Math.min(this.durationMs, this.t + dt * this.speed);
    if (this.t >= this.durationMs) this.isPlaying = false;
    this.publish(!this.isPlaying || wall - this.shown > 100, wall);
    if (this.isPlaying) this.frameId = requestAnimationFrame(this.tick);
  };

  private publish(view: boolean, wall = 0) {
    this.frameListeners.forEach((listener) => listener());
    if (!view) return;
    this.shown = wall;
    this.view = { t: this.t, playing: this.isPlaying, speed: this.speed };
    this.viewListeners.forEach((listener) => listener());
  }
}

export interface Playback {
  clock: PlaybackClock;
  t: number;
  playing: boolean;
  speed: Speed;
  durationMs: number;
  play: () => void;
  pause: () => void;
  restart: () => void;
  seek: (t: number) => void;
  setSpeed: (speed: Speed) => void;
}

/** Playback of the run identified by `runKey` (null: none), lasting `durationMs`. */
export function usePlayback(durationMs: number, runKey: string | null, autoPlay: boolean): Playback {
  const [store] = useState(() => new PlaybackStore());
  useEffect(() => store.load(runKey, durationMs, autoPlay), [store, runKey, durationMs, autoPlay]);
  useEffect(() => () => store.dispose(), [store]);
  const view = useSyncExternalStore(store.subscribeView, store.getView);
  return { clock: store, t: view.t, playing: view.playing, speed: view.speed, durationMs, play: store.play, pause: store.pause, restart: store.restart, seek: store.seek, setSpeed: store.setSpeed };
}

/** The moment a clock shows, followed on every animation frame (for the 3D overlay). */
export function useClockTime(clock: PlaybackClock): number {
  return useSyncExternalStore(clock.subscribe, clock.now);
}
