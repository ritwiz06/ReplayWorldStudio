// Typed access to the local API. Every response is checked against the generated contract
// schema before the UI sees it, and every failure is classified so it can be explained.
import {
  SCHEMA_VERSION,
  validateAssistStatus,
  validateCatalogAsset,
  validateDrawingAnalysis,
  validateEditProposalResult,
  validateEvidenceBundleOpened,
  validateEvidenceInventory,
  validateGeneratedModel,
  validateGeneratedModelRestoreReport,
  validateHealthResponse,
  validateImageProposalResult,
  validateModelRevisionProposalResult,
  validateObjectProposalResult,
  validatePlanProposalResult,
  validateProcessSuggestionResult,
  validatePlanUpload,
  validateProject,
  validateStoredPhoto,
  validateUpgradeReport,
  validateValidationErrorResponse,
  validateValidationReport,
  type ContractIssue,
  type EditProposalRequest,
  type EvidenceBundleRequest,
  type GeneratedAssetRequest,
  type GeneratedAssetRevisionRequest,
  type GeometryDraft,
  type ImageAnalysisRequest,
  type ProcessSuggestionRequest,
  type ModelRevisionProposalRequest,
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

export type FixtureName = "industrial-demo" | "foundation" | "sample";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

interface RequestOptions {
  method?: "GET" | "POST";
  body?: string | Blob;
  /** Content type of a binary body (a photo); JSON otherwise. */
  contentType?: string;
  /** An upload's original name, sent in a header so it never appears in a URL a proxy may log. */
  filename?: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}

const TIMEOUT_MS = 8_000;
/** A language model can take a minute or more to draft a structured proposal. */
export const ASSIST_TIMEOUT_MS = 180_000;
const GENERATE_TIMEOUT_MS = 30_000;

export function createApiClient(
  baseUrl: string = API_BASE_URL,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
) {
  async function request<T>(
    path: string,
    validate: (data: unknown) => ValidationResult<T>,
    { method = "GET", body, contentType, filename, signal, timeoutMs = TIMEOUT_MS }: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    const headers: Record<string, string> =
      body === undefined ? { Accept: "application/json" } : contentType ? { Accept: "application/json", "Content-Type": contentType } : { ...JSON_HEADERS };
    if (filename !== undefined) headers["X-Filename"] = encodeURIComponent(filename);
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ?? null,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (isAbortError(err)) throw err; // the caller cancelled; not a failure to report
      const message = isTimeoutError(err)
        ? `The API at ${baseUrl} did not respond within ${timeoutMs / 1000} s.`
        : `Could not reach the API at ${baseUrl}.`;
      return failure({ kind: "network", message });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      if (isAbortError(err)) throw err;
      // The timeout also covers reading the body: a slow answer is not a malformed one.
      if (isTimeoutError(err)) return failure({ kind: "network", message: `The API at ${baseUrl} did not respond within ${timeoutMs / 1000} s.` });
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
    /** Sends the document text unchanged so the API remains the authority on validity. With
     * `allowMissingSources`, absent source photos are listed instead of refusing the file. */
    validateProjectDocument: (text: string, signal?: AbortSignal, allowMissingSources = false) =>
      request(`/api/v1/projects/validate${allowMissingSources ? "?missing_sources=allow" : ""}`, validateValidationReport, {
        method: "POST",
        body: text,
        signal,
        // The API reads and checks every model and source file the project names.
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Upgrades an older document through the API's migration chain, for review; nothing is stored. */
    upgradeProjectDocument: (text: string, signal?: AbortSignal) =>
      request("/api/v1/projects/upgrade", validateUpgradeReport, {
        method: "POST",
        body: text,
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Whether language proposals are available, and where requests would go. */
    getAssistStatus: (signal?: AbortSignal) => request("/api/v1/assist/status", validateAssistStatus, { signal }),
    /** Draft a typed proposal for a described object (sent to the configured provider). */
    proposeObject: (description: string, signal?: AbortSignal) =>
      request("/api/v1/assist/object-proposals", validateObjectProposalResult, {
        method: "POST",
        body: JSON.stringify({ description }),
        signal,
        timeoutMs: ASSIST_TIMEOUT_MS,
      }),
    /** Interpret one edit request against a summary of the scene; nothing is changed. */
    proposeEdit: (body: EditProposalRequest, signal?: AbortSignal) =>
      request("/api/v1/assist/edit-proposals", validateEditProposalResult, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: ASSIST_TIMEOUT_MS,
      }),
    /** Build a model from a geometry draft for preview (returned as bytes; nothing stored). */
    previewGeneratedModel: (spec: GeometryDraft, signal?: AbortSignal) =>
      request("/api/v1/catalog/generated-models/preview", validateGeneratedModel, {
        method: "POST",
        body: JSON.stringify({ spec }),
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Create a catalog asset from a reviewed proposal; its model is stored and hash-pinned. */
    createGeneratedAsset: (body: GeneratedAssetRequest, signal?: AbortSignal) =>
      request("/api/v1/catalog/generated-assets", validateCatalogAsset, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Propose a bounded change to a generated model's specification from one instruction (sent
     * to the configured language model); nothing is built or stored. */
    proposeModelRevision: (body: ModelRevisionProposalRequest, signal?: AbortSignal) =>
      request("/api/v1/assist/model-revisions", validateModelRevisionProposalResult, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: ASSIST_TIMEOUT_MS,
      }),
    /** Build a revision of a generated asset as a new catalog asset; the previous one is unchanged. */
    reviseGeneratedAsset: (body: GeneratedAssetRevisionRequest, signal?: AbortSignal) =>
      request("/api/v1/catalog/generated-assets/revisions", validateCatalogAsset, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Propose the objects on the floor of a photo (sent to the configured vision model). */
    analysePhoto: (body: ImageAnalysisRequest, signal?: AbortSignal) =>
      request("/api/v1/assist/image-proposals", validateImageProposalResult, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: ASSIST_TIMEOUT_MS,
      }),
    /** Store an original photo in the local source library. With `expectedSha256` (re-attaching
     * a missing photo), a different file is refused and nothing is written. */
    uploadPhoto: (file: Blob, filename: string, expectedSha256?: string, signal?: AbortSignal) => {
      const query = expectedSha256 ? `?${new URLSearchParams({ expected_sha256: expectedSha256 }).toString()}` : "";
      return request(`/api/v1/sources/photos${query}`, validateStoredPhoto, {
        method: "POST",
        body: file,
        filename,
        contentType: file.type || "application/octet-stream",
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      });
    },
    /** Read a DXF drawing (deterministically; no language model) and store it by its sha256.
     * Nothing is added to a project; a DWG or unreadable file is refused and not stored. */
    uploadDrawing: (file: Blob, filename: string, signal?: AbortSignal) =>
      request("/api/v1/sources/drawings", validateDrawingAnalysis, {
        method: "POST",
        body: file,
        filename,
        contentType: "application/octet-stream",
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Store a floor-plan PDF, PNG or JPEG (IMP-03; no language model). An image or a one-page
     * PDF comes back read as a picture in pixels; a longer PDF lists its pages. */
    uploadPlan: (file: Blob, filename: string, signal?: AbortSignal) =>
      request("/api/v1/sources/plans", validatePlanUpload, {
        method: "POST",
        body: file,
        filename,
        contentType: "application/octet-stream",
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Render the chosen page of a stored PDF and read it. */
    readPlanPage: (sha256: string, page: number, filename: string, signal?: AbortSignal) =>
      request(`/api/v1/sources/plans/${sha256}/pages/${page}`, validateDrawingAnalysis, {
        method: "POST",
        filename,
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
      }),
    /** Draft the floor, walls and objects of a plan picture (sent to the configured vision
     * model); nothing is stored. */
    proposePlan: (body: ImageAnalysisRequest, signal?: AbortSignal) =>
      request("/api/v1/assist/plan-proposals", validatePlanProposalResult, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: ASSIST_TIMEOUT_MS,
      }),
    /** Suggest station roles, order and questions for Run a day (sent to the configured
     * language model); nothing is applied or stored, and no operating value is suggested. */
    suggestProcess: (body: ProcessSuggestionRequest, signal?: AbortSignal) =>
      request("/api/v1/assist/process-suggestions", validateProcessSuggestionResult, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
        timeoutMs: ASSIST_TIMEOUT_MS,
      }),
    /** Delete every file this visitor stored on the public preview's server, now. */
    clearVisitorFiles: (signal?: AbortSignal) =>
      request("/api/v1/visitor/clear", (data: unknown) => (data !== null && typeof data === "object" && (data as { status?: unknown }).status === "deleted" ? { ok: true as const, value: "deleted" as const } : { ok: false as const, issues: [] }), {
        method: "POST",
        body: "{}",
        signal,
      }),
    /** Where the API serves a stored source photo. */
    sourceFileUrl: (uri: string) => `${baseUrl}/api/v1/sources/files/${uri}`,
    /** Every source and model file the project names, and whether each can go in a bundle. */
    exportInventory: (projectText: string, signal?: AbortSignal) =>
      request("/api/v1/exports/inventory", validateEvidenceInventory, { method: "POST", body: projectText, signal, timeoutMs: GENERATE_TIMEOUT_MS }),
    /** Package an evidence bundle: the API checks each chosen file against the project's hash and
     * returns the ZIP. Nothing is stored and the project is not changed. */
    exportBundle: async (body: EvidenceBundleRequest, signal?: AbortSignal): Promise<ApiResult<Blob>> => {
      const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/api/v1/exports`, {
          method: "POST",
          headers: { Accept: "application/zip, application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        return failure({ kind: "network", message: isTimeoutError(err) ? `The API at ${baseUrl} did not respond within ${GENERATE_TIMEOUT_MS / 1000} s.` : `Could not reach the API at ${baseUrl}.` });
      }
      if (!response.ok) {
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          data = undefined;
        }
        return failure(httpFailure(response.status, data));
      }
      return { ok: true, value: await response.blob() };
    },
    /** Check an evidence bundle and store its verified files; returns its project and event logs. */
    openBundle: (file: Blob, signal?: AbortSignal) =>
      request("/api/v1/exports/open", validateEvidenceBundleOpened, { method: "POST", body: file, contentType: "application/zip", signal, timeoutMs: GENERATE_TIMEOUT_MS }),
    /** Rebuild a project's missing generated models from their recorded specifications. */
    restoreGeneratedModels: (projectText: string, signal?: AbortSignal) =>
      request("/api/v1/catalog/generated-models/restore", validateGeneratedModelRestoreReport, {
        method: "POST",
        body: projectText,
        signal,
        timeoutMs: GENERATE_TIMEOUT_MS,
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
