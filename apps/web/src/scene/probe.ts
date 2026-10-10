import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Calls `report` from the render loop at most every `intervalMs`, and once more after the last
 * rendered frame of a movement. The canvas renders on demand, so without the trailing call a
 * reading taken mid-movement could be the last one the page ever sees.
 */
export function useFrameProbe(report: () => void, intervalMs = 150) {
  const latest = useRef(report);
  useLayoutEffect(() => {
    latest.current = report;
  });
  const last = useRef(0);
  const trailing = useRef<number | null>(null);
  useFrame(() => {
    if (trailing.current !== null) window.clearTimeout(trailing.current);
    trailing.current = null;
    const now = performance.now();
    if (now - last.current >= intervalMs) {
      last.current = now;
      latest.current();
      return;
    }
    trailing.current = window.setTimeout(() => {
      trailing.current = null;
      last.current = performance.now();
      latest.current();
    }, intervalMs);
  });
  useEffect(
    () => () => {
      if (trailing.current !== null) window.clearTimeout(trailing.current);
    },
    [],
  );
}
