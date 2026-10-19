// How "Run a day" names and colours what it shows, shared by the panel and the 3D overlay.
import type { StationState } from "./engine";

export const STATE_COLOUR: Record<StationState, string> = {
  running: "#57d9a3",
  loading: "#3fb6d6",
  waiting: "#f0b429",
  idle: "#8b949e",
  blocked: "#ff8c42",
  down: "#ff5c57",
};

export const STATE_WORDS: Record<StationState, string> = {
  running: "running",
  loading: "being loaded",
  waiting: "waiting for a worker",
  idle: "idle, nothing to do",
  blocked: "blocked: output full",
  down: "stopped",
};

/** Short words for the labels in the 3D view. */
export const STATE_SHORT: Record<StationState, string> = {
  running: "running",
  loading: "loading",
  waiting: "needs a worker",
  idle: "idle",
  blocked: "blocked",
  down: "stopped",
};

export const SCOPE =
  "Predicts what happens under the assumptions listed here, on this layout. It does not verify real productivity, worker safety, forces, structural strength or chemistry, and the equipment models are illustrations: their insides are not simulated.";
