import { SCHEMA_VERSION } from "@replay-world/contracts";
import { BUILD } from "../build";
import type { HealthState } from "../hooks/useHealth";


export function HealthIndicator({ state }: { state: HealthState }) {
  // A page and an API from different versions (an old server still running) cannot work
  // together reliably: say so plainly instead of failing later in odd ways.
  const stale = state.status === "online" && state.health.schema_version !== SCHEMA_VERSION;
  const [tone, text, detail] =
    state.status === "online"
      ? stale
        ? [
            "error",
            "Old server: restart it",
            `This page (build ${BUILD}) uses contract ${SCHEMA_VERSION}, but the API answering it uses ${state.health.schema_version}. Stop the old server and run pnpm start again.`,
          ]
        : ["ok", "API online", `API ${state.health.api_version} · schema ${state.health.schema_version} · page build ${BUILD}`]
      : state.status === "offline"
        ? ["error", "API unreachable", state.error.message]
        : ["pending", "Checking API…", "Contacting the local API"];
  return (
    <div className={`chip chip-${tone}${stale ? " chip-stale" : ""}`} role="status" aria-live="polite" title={detail} data-testid="api-health" data-build={BUILD}>
      <span className="dot" aria-hidden="true" />
      {text}
    </div>
  );
}
