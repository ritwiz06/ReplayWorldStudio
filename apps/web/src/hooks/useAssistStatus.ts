import type { AssistStatus } from "@replay-world/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";

export type AssistState = { status: "checking" } | { status: "known"; assist: AssistStatus } | { status: "unreachable"; message: string };

/** Whether language proposals are available. Asked once (and on demand), never polled. */
export function useAssistStatus(client: ApiClient) {
  const [state, setState] = useState<AssistState>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    client.getAssistStatus(controller.signal).then(
      (result) => setState(result.ok ? { status: "known", assist: result.value } : { status: "unreachable", message: result.error.message }),
      () => undefined,
    );
    return () => controller.abort();
  }, [client, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, refresh };
}
