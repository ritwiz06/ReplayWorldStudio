const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

/** Where the browser reaches the local API. Override with VITE_API_BASE_URL in the root .env. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
  /\/+$/,
  "",
);

/** Built for the public preview (ADR-054): the sample comes first, AI is off, and each visitor's
 * uploads are kept on the server for RETENTION_HOURS. */
export const PUBLIC_PREVIEW = import.meta.env.VITE_PUBLIC_PREVIEW === "1";
export const RETENTION_HOURS = Number(import.meta.env.VITE_RETENTION_HOURS || 24);
export const FEEDBACK_URL = "https://github.com/ritwiz06/ReplayWorldStudio/issues/new";
export const SOURCE_URL = "https://github.com/ritwiz06/ReplayWorldStudio";
