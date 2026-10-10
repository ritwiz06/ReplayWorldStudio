// Page-side benchmark instrumentation, injected before the app loads (Playwright addInitScript).
// It must be self-contained: Playwright sends this function's source to the page.
//
// - three.js announces each WebGLRenderer and Scene to `__THREE_DEVTOOLS__`; we keep them to read
//   renderer counters, so the app itself carries no benchmark code.
// - A requestAnimationFrame loop records frame-to-frame intervals and per-frame draw calls and
//   triangles (renderer.info is reset once per frame, so it counts every render pass, shadows
//   and the axis gizmo included).
// - Load milestones are taken on the first frame after the viewport reports a loaded scene
//   (first useful scene) and after every catalog model is verified (all models ready).
// - Long animation frames (> 50 ms, Chrome's LoAF API) are kept with their script attribution.

export interface FrameWindow {
  frames: number[];
  calls: number[];
  triangles: number[];
  longFrames: { start: number; duration: number; blocking: number; scripts: string[] }[];
}

export function instrument(): void {
  interface RenderInfo {
    autoReset: boolean;
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
    programs: unknown[] | null;
    reset(): void;
  }
  interface Renderer {
    isWebGLRenderer?: boolean;
    info: RenderInfo;
    getContext(): WebGL2RenderingContext;
    getPixelRatio(): number;
    shadowMap: { enabled: boolean; type: number };
    domElement: HTMLCanvasElement;
  }
  interface Material {
    uuid: string;
    type: string;
    transparent: boolean;
    [key: string]: unknown;
  }
  interface Node {
    isScene?: boolean;
    isMesh?: boolean;
    isLight?: boolean;
    castShadow?: boolean;
    visible: boolean;
    material?: Material | Material[];
    geometry?: { uuid: string; index: { count: number } | null; attributes: { position?: { count: number } } };
    traverseVisible(callback: (node: Node) => void): void;
  }

  const renderers: Renderer[] = [];
  const scenes: Node[] = [];
  const marks: Record<string, number> = {};
  /** Long animation frames before every model is ready (load phase). */
  const loadLongFrames: FrameWindow["longFrames"] = [];
  const devtools = new EventTarget();
  devtools.addEventListener("observe", (event) => {
    const detail = (event as CustomEvent<Renderer & Node>).detail;
    if (detail.isWebGLRenderer) {
      detail.info.autoReset = false;
      renderers.push(detail);
      marks.rendererCreated ??= performance.now();
    } else if (detail.isScene) scenes.push(detail);
  });
  const page = window as unknown as Record<string, unknown>;
  page.__THREE_DEVTOOLS__ = devtools;

  let recording = false;
  let last = 0;
  let current: FrameWindow = { frames: [], calls: [], triangles: [], longFrames: [] };
  let renderedOnce = false;
  let modelsSeen = false;

  try {
    new PerformanceObserver((list) => {
      const target = recording ? current.longFrames : marks.modelsReady === undefined ? loadLongFrames : null;
      if (!target) return;
      for (const entry of list.getEntries() as unknown as {
        startTime: number;
        duration: number;
        blockingDuration: number;
        scripts?: { invoker: string; sourceFunctionName: string; duration: number }[];
      }[]) {
        target.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: entry.blockingDuration,
          scripts: (entry.scripts ?? []).slice(0, 3).map((s) => `${s.invoker} ${s.sourceFunctionName} ${Math.round(s.duration)} ms`),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch {
    // The LoAF API is Chromium-only; frame intervals are still recorded.
  }

  const viewport = () => document.querySelector<HTMLElement>('[data-testid="viewport"]');

  const tick = (now: number) => {
    const renderer = renderers[0];
    const calls = renderer?.info.render.calls ?? 0;
    const triangles = renderer?.info.render.triangles ?? 0;
    renderer?.info.reset();
    if (recording && last > 0) {
      current.frames.push(now - last);
      current.calls.push(calls);
      current.triangles.push(triangles);
    }
    last = now;

    // First useful scene: the viewport reports a loaded scene and the canvas has drawn it. All
    // models ready: the first frame drawn after every model was reported verified. (The canvas
    // renders on demand, so a milestone waits for a drawn frame, not for any animation frame.)
    if (calls > 0) renderedOnce = true;
    if (marks.firstScene === undefined) {
      if (renderedOnce && viewport()?.dataset.renderer === "ready") marks.firstScene = now;
    } else if (marks.modelsReady === undefined) {
      if (modelsSeen && calls > 0) marks.modelsReady = now;
      const match = /^(\d+)\/(\d+) ready, 0 failed$/.exec(viewport()?.dataset.models ?? "");
      modelsSeen = match !== null && match[1] === match[2] && Number(match[2]) > 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const materialsOf = (node: Node): Material[] => (Array.isArray(node.material) ? node.material : node.material ? [node.material] : []);

  page.__bench = {
    marks,
    loadLongFrames,
    start() {
      current = { frames: [], calls: [], triangles: [], longFrames: [] };
      last = 0;
      recording = true;
    },
    stop(): FrameWindow {
      recording = false;
      return current;
    },
    gpu() {
      const renderer = renderers[0];
      if (!renderer) return null;
      const gl = renderer.getContext();
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const attributes = gl.getContextAttributes();
      return {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        antialias: attributes?.antialias ?? null,
        devicePixelRatio: window.devicePixelRatio,
        rendererPixelRatio: renderer.getPixelRatio(),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        canvasCss: [renderer.domElement.clientWidth, renderer.domElement.clientHeight],
        shadowMapType: renderer.shadowMap.enabled ? renderer.shadowMap.type : null,
      };
    },
    complexity() {
      const renderer = renderers[0];
      // The R3F root scene holds everything; other scenes (environment, axis gizmo) are small.
      let root: Node | null = null;
      let rootSize = -1;
      for (const scene of scenes) {
        let size = 0;
        scene.traverseVisible(() => size++);
        if (size > rootSize) {
          root = scene;
          rootSize = size;
        }
      }
      const materials = new Set<string>();
      const geometries = new Set<string>();
      const textures = new Set<unknown>();
      let meshes = 0;
      let transparentMeshes = 0;
      let triangles = 0;
      let shadowCasters = 0;
      root?.traverseVisible((node) => {
        if (node.isLight && node.castShadow) shadowCasters++;
        if (!node.isMesh || !node.geometry) return;
        meshes++;
        geometries.add(node.geometry.uuid);
        const count = node.geometry.index ? node.geometry.index.count : (node.geometry.attributes.position?.count ?? 0);
        triangles += count / 3;
        for (const material of materialsOf(node)) {
          materials.add(material.uuid);
          if (material.transparent) transparentMeshes++;
          for (const value of Object.values(material)) {
            if (value && typeof value === "object" && (value as { isTexture?: boolean }).isTexture) textures.add(value);
          }
        }
      });
      return {
        visibleMeshes: meshes,
        transparentMeshes,
        sceneTriangles: Math.round(triangles),
        uniqueMaterials: materials.size,
        uniqueGeometries: geometries.size,
        materialTextures: textures.size,
        shadowCastingLights: shadowCasters,
        gpuGeometries: renderer?.info.memory.geometries ?? null,
        gpuTextures: renderer?.info.memory.textures ?? null,
        shaderPrograms: renderer?.info.programs?.length ?? null,
      };
    },
  };
}
