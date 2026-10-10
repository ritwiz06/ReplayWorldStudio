import type { GltfVisual, Project } from "@replay-world/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import type { ApiClient } from "../api/client";
import { loadCatalogModel, type ModelFailure } from "../scene/modelLoader";

export type ModelState =
  | { status: "loading" }
  | { status: "ready"; template: Group }
  | { status: "failed"; failure: ModelFailure };

/** Model state per catalog asset id, for assets with a glTF visual. */
export type ModelStates = ReadonlyMap<string, ModelState>;

export interface ModelSummary {
  total: number;
  ready: number;
  loading: number;
  failed: number;
}

export function summarise(states: ModelStates): ModelSummary {
  const all = [...states.values()];
  return {
    total: all.length,
    ready: all.filter((s) => s.status === "ready").length,
    loading: all.filter((s) => s.status === "loading").length,
    failed: all.filter((s) => s.status === "failed").length,
  };
}

function gltfAssets(catalog: Project["catalog"] | null): [string, GltfVisual][] {
  return (catalog ?? []).flatMap((a) => (a.visual.type === "gltf" ? [[a.id, a.visual]] : []));
}

const keyOf = (id: string, visual: GltfVisual, attempt: number) => `${id}|${visual.sha256}|${attempt}`;

/**
 * Loads every glTF visual in the project's catalog once (instances share the template).
 * Each asset's state is independent: one failed model never blocks the others. Results are
 * keyed by asset, file hash and attempt, so a stale result is never shown for a newer project.
 */
export function useCatalogModels(client: ApiClient, project: Project | null) {
  const [results, setResults] = useState<ReadonlyMap<string, ModelState>>(new Map());
  const [attempt, setAttempt] = useState(0);
  // Keyed on the catalog, not the project: scene edits create a new project value but keep the
  // same catalog, and must not download the models again.
  const catalog = project?.catalog ?? null;
  const assets = useMemo(() => gltfAssets(catalog), [catalog]);

  // Each (asset, file hash, attempt) is downloaded once per session: adding a generated asset
  // to the catalog (or undoing that) must not download the other models again. A result for an
  // asset no longer in the catalog is simply never shown. (Downloads are not cancelled: the
  // editor lives as long as the page, and a cancel-on-cleanup would lose loads under StrictMode's
  // double-mounted effects.)
  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const [id, visual] of assets) {
      const key = keyOf(id, visual, attempt);
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      void loadCatalogModel(client.catalogFileUrl(visual.uri), visual).then((result) =>
        setResults((current) =>
          new Map(current).set(
            key,
            result.ok ? { status: "ready", template: result.scene } : { status: "failed", failure: result.failure },
          ),
        ),
      );
    }
  }, [client, assets, attempt]);

  const models: ModelStates = useMemo(
    () => new Map(assets.map(([id, visual]) => [id, results.get(keyOf(id, visual, attempt)) ?? { status: "loading" }])),
    [assets, results, attempt],
  );
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { models, retry };
}
