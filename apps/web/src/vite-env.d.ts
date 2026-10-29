/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** "1" in the public preview build (ADR-054). */
  readonly VITE_PUBLIC_PREVIEW?: string;
  readonly VITE_RETENTION_HOURS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The commit and time this page was built from (vite.config.ts). */
declare const __BUILD__: string;
