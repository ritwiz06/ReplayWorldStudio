// Typed access to the local API. Every response is checked against the generated contract
// schema before the UI sees it, and every failure is classified so it can be explained.
import {
  SCHEMA_VERSION,
  validateHealthResponse,
  validateProject,
  validateUpgradeReport,
  validateValidationErrorResponse,
  validateValidationReport,
  type ContractIssue,
  type ValidationIssue,
  type ValidationResult,
} from "@replay-world/contracts";
import { API_BASE_URL } from "../config";

export type ApiFailure =
  /** The request never produced a response: API stopped, wrong URL, CORS refusal or timeout. */
  | { kind: "network"; message: string }
  /** The API answered with an error status; 422 responses carry located issues. */
  | { kind: "http"; status: number; message: string; issues: ContractIssue[] }
  /** The API answered 2xx with a body that is not JSON. */
  | { kind: "parse"; message: string }
  /** The API answered 2xx with JSON that does not match the contract. */
  | { kind: "contract"; message: string; issues: ContractIssue[] };

export type FixtureName = "industrial-demo" | "foundation";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

interface RequestOptions {
  method?: "GET" | "POST";
  body?: string;
  signal?: AbortSignal | undefined;
}

const TIMEOUT_MS = 8_000;

export function createApiClient(
  baseUrl: string = API_BASE_URL,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
) {
  async function request<T>(
    path: string,
    validate: (data: unknown) => ValidationResult<T>,
    { method = "GET", body, signal }: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : JSON_HEADERS,
        body: body ?? null,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (isAbortError(err)) throw err; // the caller cancelled; not a failure to report
      const message = isTimeoutError(err)
        ? `The API at ${baseUrl} did not respond within ${TIMEOUT_MS / 1000} s.`
        : `Could not reach the API at ${baseUrl}.`;
      return failure({ kind: "network", message });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      if (isAbortError(err)) throw err;
      return failure(
        response.ok
          ? { kind: "parse", message: `${path} returned a response that is not JSON.` }
          : httpFailure(response.status, undefined),
      );
    }
    if (!response.ok) return failure(httpFailure(response.status, data));

    const checked = validate(data);
    return checked.ok
      ? checked
      : failure({
          kind: "contract",
          message: `The response from ${path} does not match contract ${SCHEMA_VERSION}.`,
          issues: checked.issues,
        });
  }

  return {
    baseUrl,
    getHealth: (signal?: AbortSignal) => request("/health", validateHealthResponse, { signal }),
    getFixture: (name: FixtureName, signal?: AbortSignal) =>
      request(`/api/v1/fixtures/${name}`, validateProject, { signal }),
    /** Where the API serves a catalog-library file; the path is validated server-side too. */
    catalogFileUrl: (uri: string) => `${baseUrl}/api/v1/catalog/files/${uri}`,
    /** Sends the document text unchanged so the API remains the authority on validity. */
    validateProjectDocument: (text: string, signal?: AbortSignal) =>
      request("/api/v1/projects/validate", validateValidationReport, {
        method: "POST",
        body: text,
        signal,
      }),
    /** Upgrades an older document through the API's migration chain, for review; nothing is stored. */
    upgradeProjectDocument: (text: string, signal?: AbortSignal) =>
      request("/api/v1/projects/upgrade", validateUpgradeReport, {
        method: "POST",
        body: text,
        signal,
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Converts an API error location such as ["body", "scene", 2] into "/scene/2". */
export function locationToPath(loc: ValidationIssue["loc"]): string {
  const rest = loc[0] === "body" ? loc.slice(1) : loc;
  return `/${rest.join("/")}`;
}

const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };

function failure(error: ApiFailure): { ok: false; error: ApiFailure } {
  return { ok: false, error };
}

function httpFailure(status: number, data: unknown): ApiFailure {
  const rejection = validateValidationErrorResponse(data);
  if (rejection.ok) {
    return {
      kind: "http",
      status,
      message: "The API rejected the input.",
      issues: rejection.value.detail.map((i) => ({ path: locationToPath(i.loc), message: i.msg })),
    };
  }
  const detail =
    typeof data === "object" && data !== null && "detail" in data && typeof data.detail === "string"
      ? data.detail
      : `The API returned HTTP ${status}.`;
  return { kind: "http", status, message: detail, issues: [] };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}
