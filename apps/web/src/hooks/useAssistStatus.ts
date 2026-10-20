import type { AssistStatus } from "@replay-world/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";

export type AssistState = { status: "checking" } | { status: "known"; assist: AssistStatus } | { status: "unreachable"; message: string };

/** Whether language proposals are available. Asked once (and on demand), a few more times while the API does not answer; never polled. */
export function useAssistStatus(client: ApiClient) {
  const [state, setState] = useState<AssistState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A request cancelled by this effect's cleanup never sets the state (it could otherwise land
    // after the answer that replaced it and say the AI is off), and an unreachable API is asked
    // again a few times before the answer stands.
    const ask = (tries: number) =>
      client.getAssistStatus(controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return;
          if (result.ok) return setState({ status: "known", assist: result.value });
          setState({ status: "unreachable", message: result.error.message });
          if (tries < 4) retry = setTimeout(() => void ask(tries + 1), 1500 * (tries + 1));
        },
        () => undefined,
      );
    void ask(0);
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [client, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, refresh };
}
