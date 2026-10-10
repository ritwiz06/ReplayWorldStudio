import type { HealthResponse } from "@replay-world/contracts";
import { useEffect, useState } from "react";
import type { ApiClient, ApiFailure } from "../api/client";

export type HealthState =
  | { status: "checking" }
  | { status: "online"; health: HealthResponse }
  | { status: "offline"; error: ApiFailure };

/** Polls GET /health so the indicator recovers on its own when the API restarts. */
export function useHealth(client: ApiClient, intervalMs = 10_000): HealthState {
  const [state, setState] = useState<HealthState>({ status: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const result = await client.getHealth(controller.signal);
        const next: HealthState = result.ok ? { status: "online", health: result.value } : { status: "offline", error: result.error };
        // Keep the same state object when nothing changed: a new one re-renders the whole app,
        // and with it the 3D scene, every poll.
        setState((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      } catch {
        if (controller.signal.aborted) return;
      }
      timer = setTimeout(() => void poll(), intervalMs);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, intervalMs]);

  return state;
}
