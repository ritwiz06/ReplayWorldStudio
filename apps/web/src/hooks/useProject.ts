import { SCHEMA_VERSION, validateProject, type Project, type UpgradeReport, type ValidationReport } from "@replay-world/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ApiFailure, FixtureName } from "../api/client";
import type { CommandRequest } from "../editing/commands";
import { createEditor, execute as executeCommand, redo as redoStep, undo as undoStep, type EditorState, type Outcome } from "../editing/history";
import { downloadText, projectFileName, serializeProject, upgradedFileName } from "../editing/projectFile";

export type LoadFailure = ApiFailure | { kind: "file"; message: string };

export type SceneSource =
  | { kind: "fixture"; name: FixtureName }
  | { kind: "file"; filename: string; report: ValidationReport }
  | { kind: "upgrade"; filename: string; fromVersion: string };

export type SceneState =
  | { status: "loading" }
  | { status: "loaded"; project: Project; source: SceneSource }
  | { status: "error"; error: ApiFailure };

export type FileCheck =
  | { status: "idle" }
  | { status: "checking"; filename: string }
  | { status: "rejected"; filename: string; error: LoadFailure };

/** A decision the user must make before anything is replaced. */
export type Prompt =
  | { kind: "unsaved"; action: string; proceed: () => void }
  | { kind: "upgrade"; filename: string; report: UpgradeReport; savedAs: string | null };

interface Loaded {
  status: "loaded";
  source: SceneSource;
  editor: EditorState;
  /** Revision last loaded from or saved to a file; null when the project exists only here. */
  savedRevision: number | null;
  savedAs: string | null;
}

interface Session {
  /** Increments whenever a different project replaces the current one. */
  loadId: number;
  load: { status: "loading" } | { status: "error"; error: ApiFailure } | Loaded;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const FIXTURE_LABEL: Record<FixtureName, string> = {
  "industrial-demo": "Industrial demo",
  foundation: "Foundation fixture",
};

const isDirty = (s: Session): boolean => s.load.status === "loaded" && s.load.savedRevision !== s.load.editor.project.scene.revision;
const editorOf = (s: Session): EditorState | null => (s.load.status === "loaded" ? s.load.editor : null);

/**
 * The open project and everything that can replace or change it. Fixtures come from the API;
 * local files are opened only after the API accepts them (older contracts are upgraded by the
 * API and reviewed first). Edits go through the command engine. Unsaved edits are never
 * replaced without the user choosing to save or discard them.
 */
export function useProject(client: ApiClient, initial: FixtureName = "industrial-demo") {
  const [session, setSessionState] = useState<Session>({ loadId: 0, load: { status: "loading" } });
  const current = useRef(session);
  const setSession = useCallback((next: Session) => {
    current.current = next;
    setSessionState(next);
  }, []);
  const [fileCheck, setFileCheck] = useState<FileCheck>({ status: "idle" });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [fixture, setFixture] = useState<{ name: FixtureName; request: number }>({ name: initial, request: 0 });
  const pendingFixture = useRef<AbortController | null>(null);

  const replace = useCallback(
    (project: Project, source: SceneSource, savedRevision: number | null) => {
      pendingFixture.current?.abort(); // a slow fixture response must not replace this project
      setSession({
        loadId: current.current.loadId + 1,
        load: { status: "loaded", source, editor: createEditor(project), savedRevision, savedAs: null },
      });
      setFileCheck({ status: "idle" });
    },
    [setSession],
  );

  useEffect(() => {
    const controller = new AbortController();
    pendingFixture.current = controller;
    client.getFixture(fixture.name, controller.signal).then(
      (result) => {
        if (result.ok) replace(result.value, { kind: "fixture", name: fixture.name }, result.value.scene.revision);
        else setSession({ ...current.current, load: { status: "error", error: result.error } });
      },
      () => undefined, // aborted because a newer request replaced this one
    );
    return () => controller.abort();
  }, [client, fixture, replace, setSession]);

  /** Run `proceed` now, or ask first when it would discard unsaved edits. */
  const offerReplacement = useCallback((action: string, proceed: () => void) => {
    if (isDirty(current.current)) setPrompt({ kind: "unsaved", action, proceed });
    else proceed();
  }, []);

  const startFixture = useCallback(
    (name: FixtureName) => {
      setSession({ ...current.current, load: { status: "loading" } });
      setFileCheck({ status: "idle" });
      setFixture((f) => ({ name, request: f.request + 1 }));
    },
    [setSession],
  );

  const loadFixture = useCallback(
    (name: FixtureName) => offerReplacement(`load the ${FIXTURE_LABEL[name].toLowerCase()}`, () => startFixture(name)),
    [offerReplacement, startFixture],
  );

  const reloadFixture = useCallback(() => startFixture(fixture.name), [fixture.name, startFixture]);

  const openFile = useCallback(
    async (file: File) => {
      const filename = file.name;
      const reject = (error: LoadFailure) => setFileCheck({ status: "rejected", filename, error });
      if (file.size > MAX_FILE_BYTES) {
        reject({ kind: "file", message: "The file is larger than the 5 MB limit for a project." });
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

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined; // the API reports exactly where the JSON breaks
      }
      const version = typeof data === "object" && data !== null && "schema_version" in data ? data.schema_version : undefined;
      if (typeof version === "string" && version !== SCHEMA_VERSION) {
        // Another contract version: the API upgrades it (or explains why it cannot) for review.
        const upgrade = await client.upgradeProjectDocument(text);
        if (!upgrade.ok) {
          reject(upgrade.error);
          return;
        }
        setFileCheck({ status: "idle" });
        setPrompt({ kind: "upgrade", filename, report: upgrade.value, savedAs: null });
        return;
      }

      const verdict = await client.validateProjectDocument(text);
      if (!verdict.ok) {
        reject(verdict.error);
        return;
      }
      // The API accepted the document; recheck the same text locally before rendering it.
      const local = data === undefined ? null : validateProject(data);
      if (!local?.ok) {
        reject({ kind: "contract", message: "The file does not match the contract.", issues: local?.issues ?? [] });
        return;
      }
      setFileCheck({ status: "idle" });
      const project = local.value;
      offerReplacement(`open ${filename}`, () => replace(project, { kind: "file", filename, report: verdict.value }, project.scene.revision));
    },
    [client, offerReplacement, replace],
  );

  const dismissFileCheck = useCallback(() => setFileCheck({ status: "idle" }), []);

  const update = useCallback(
    (outcome: Outcome): Outcome => {
      const s = current.current;
      if (outcome.ok && s.load.status === "loaded") setSession({ ...s, load: { ...s.load, editor: outcome.state } });
      return outcome;
    },
    [setSession],
  );

  const execute = useCallback(
    (request: CommandRequest): Outcome | null => {
      const editor = editorOf(current.current);
      return editor ? update(executeCommand(editor, request)) : null;
    },
    [update],
  );

  const undo = useCallback((): Outcome | null => {
    const editor = editorOf(current.current);
    return editor ? update(undoStep(editor, editor.project.scene.revision)) : null;
  }, [update]);

  const redo = useCallback((): Outcome | null => {
    const editor = editorOf(current.current);
    return editor ? update(redoStep(editor, editor.project.scene.revision)) : null;
  }, [update]);

  /** Download the project as JSON; the saved revision becomes the clean state. */
  const save = useCallback((): string | null => {
    const s = current.current;
    if (s.load.status !== "loaded") return null;
    const project = s.load.editor.project;
    const filename = projectFileName(project);
    downloadText(filename, serializeProject(project));
    setSession({ ...s, load: { ...s.load, savedRevision: project.scene.revision, savedAs: filename } });
    return filename;
  }, [setSession]);

  const resolveUnsaved = useCallback(
    (choice: "save" | "discard" | "cancel") => {
      if (prompt?.kind !== "unsaved") return;
      setPrompt(null);
      if (choice === "cancel") return;
      if (choice === "save") save();
      prompt.proceed();
    },
    [prompt, save],
  );

  const openUpgraded = useCallback(() => {
    if (prompt?.kind !== "upgrade") return;
    const { filename, report } = prompt;
    setPrompt(null);
    // Not saved anywhere yet in the new version, so it counts as unsaved until saved.
    offerReplacement(`open the upgraded ${filename}`, () =>
      replace(report.project, { kind: "upgrade", filename, fromVersion: report.from_version }, null),
    );
  }, [offerReplacement, prompt, replace]);

  const saveUpgraded = useCallback(() => {
    if (prompt?.kind !== "upgrade") return;
    const name = upgradedFileName(prompt.filename, prompt.report.to_version);
    downloadText(name, serializeProject(prompt.report.project));
    setPrompt({ ...prompt, savedAs: name });
  }, [prompt]);

  const closePrompt = useCallback(() => setPrompt(null), []);

  const dirty = isDirty(session);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const load = session.load;
  const scene: SceneState =
    load.status === "loaded" ? { status: "loaded", project: load.editor.project, source: load.source } : load;
  const editor = load.status === "loaded" ? load.editor : null;

  return {
    scene,
    loadId: session.loadId,
    fixtureName: fixture.name,
    fileCheck,
    prompt,
    dirty,
    savedAs: load.status === "loaded" ? load.savedAs : null,
    undoLabel: editor?.undo.at(-1)?.change.label ?? null,
    redoLabel: editor?.redo.at(-1)?.change.label ?? null,
    loadFixture,
    reloadFixture,
    openFile,
    dismissFileCheck,
    execute,
    undo,
    redo,
    save,
    resolveUnsaved,
    openUpgraded,
    saveUpgraded,
    closePrompt,
  };
}

export type ProjectSession = ReturnType<typeof useProject>;
