import type { HealthState } from "../hooks/useHealth";

export function HealthIndicator({ state }: { state: HealthState }) {
  const [tone, text, detail] =
    state.status === "online"
      ? ["ok", "API online", `API ${state.health.api_version} · schema ${state.health.schema_version}`]
      : state.status === "offline"
        ? ["error", "API unreachable", state.error.message]
        : ["pending", "Checking API…", "Contacting the local API"];
  return (
    <div className={`chip chip-${tone}`} role="status" aria-live="polite" title={detail} data-testid="api-health">
      <span className="dot" aria-hidden="true" />
      {text}
    </div>
  );
}
