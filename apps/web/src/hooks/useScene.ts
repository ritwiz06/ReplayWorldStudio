import { validateProject, type Project, type ValidationReport } from "@replay-world/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ApiFailure } from "../api/client";

export type LoadFailure = ApiFailure | { kind: "file"; message: string };

export type SceneSource =
  | { kind: "fixture" }
  | { kind: "file"; filename: string; report: ValidationReport };

export type SceneState =
  | { status: "loading" }
  | { status: "loaded"; project: Project; source: SceneSource }
  | { status: "error"; error: ApiFailure };

export type FileCheck =
  | { status: "idle" }
  | { status: "checking"; filename: string }
  | { status: "rejected"; filename: string; error: LoadFailure };

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Loads the foundation fixture from the API, and opens local project files only after the API
 * accepts them. A rejected file never replaces the scene that is already loaded.
 */
export function useScene(client: ApiClient) {
  const [scene, setScene] = useState<SceneState>({ status: "loading" });
  const [fileCheck, setFileCheck] = useState<FileCheck>({ status: "idle" });
  const [fixtureRequest, setFixtureRequest] = useState(0);
  const pendingFixture = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    pendingFixture.current = controller;
    client.getFoundationFixture(controller.signal).then(
      (result) =>
        setScene(
          result.ok
            ? { status: "loaded", project: result.value, source: { kind: "fixture" } }
            : { status: "error", error: result.error },
        ),
      () => undefined, // aborted because a newer request replaced this one
    );
    return () => controller.abort();
  }, [client, fixtureRequest]);

  const reloadFixture = useCallback(() => {
    setScene({ status: "loading" });
    setFileCheck({ status: "idle" });
    setFixtureRequest((n) => n + 1);
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      const filename = file.name;
      const reject = (error: LoadFailure) => setFileCheck({ status: "rejected", filename, error });
      if (file.size > MAX_FILE_BYTES) {
        reject({ kind: "file", message: "The file is larger than the 5 MB limit for a scene." });
        return;
      }
      setFileCheck({ status: "checking", filename });
      let text: string;
      try {
        text = await file.text();
      } catch {
        reject({ kind: "file", message: "The file could not be read." });
        return;
      }

      const verdict = await client.validateProjectDocument(text);
      if (!verdict.ok) {
        reject(verdict.error);
        return;
      }
      // The API accepted the document; parse the same text and recheck its structure locally
      // before rendering, so the UI never trusts unchecked data.
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        reject({ kind: "parse", message: "The file is not valid JSON." });
        return;
      }
      const local = validateProject(data);
      if (!local.ok) {
        reject({ kind: "contract", message: "The file does not match the contract.", issues: local.issues });
        return;
      }
      pendingFixture.current?.abort(); // a slow fixture response must not replace this file
      setScene({
        status: "loaded",
        project: local.value,
        source: { kind: "file", filename, report: verdict.value },
      });
      setFileCheck({ status: "idle" });
    },
    [client],
  );

  const dismissFileCheck = useCallback(() => setFileCheck({ status: "idle" }), []);

  return { scene, fileCheck, reloadFixture, openFile, dismissFileCheck };
}
