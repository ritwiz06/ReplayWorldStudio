# Replay World Studio public preview (ADR-054, ADR-056): one container, the built web app served
# by the API on the same origin. Mount a volume at /data (visitors' files, deleted after 24 hours);
# on Railway that is a service volume (railway.json requires it): no VOLUME line here, Railway
# refuses Dockerfiles that declare one.
#   docker build -t replay-world-studio .
#   docker run -p 127.0.0.1:8000:8000 -v rws-data:/data replay-world-studio
# AI is off in this image whatever the environment holds (RWS_PUBLIC=1 never reads a key).
# The entrypoint starts as root only to give /data to rws (uid 10001), then drops privileges.

# --- The web app, built for the preview ------------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@replay-world/web..."
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# Same origin, the preview's wording and limits; no VITE_ variable carries a secret.
ENV VITE_API_BASE_URL=/ VITE_PUBLIC_PREVIEW=1 VITE_RETENTION_HOURS=24
RUN pnpm --filter @replay-world/web exec vite build

# --- The API ---------------------------------------------------------------------------------
FROM python:3.14-slim-bookworm AS app
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never UV_PYTHON=/usr/local/bin/python3
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
COPY packages/contracts/pyproject.toml packages/contracts/
COPY packages/contracts/python packages/contracts/python
COPY services/api services/api
RUN uv sync --locked --no-dev
# Only what the server reads: the sample scenes and plans, and the shared catalog models.
COPY fixtures/scenes fixtures/scenes
COPY fixtures/drawings fixtures/drawings
COPY fixtures/plans fixtures/plans
COPY assets/catalog assets/catalog
COPY --from=web /repo/apps/web/dist /app/web
COPY scripts/container-entrypoint.sh /usr/local/bin/rws-entrypoint
RUN groupadd --gid 10001 rws && useradd --uid 10001 --gid 10001 --create-home rws && mkdir -p /data && chown rws:rws /data
ENV RWS_PUBLIC=1 \
    RWS_ENV_FILE=none \
    RWS_WEB_DIR=/app/web \
    RWS_DATA_DIR=/data \
    RWS_TRUST_PROXY=1 \
    PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health',timeout=4)"
ENTRYPOINT ["/usr/local/bin/rws-entrypoint"]
CMD ["/app/.venv/bin/python", "-m", "replay_world_api"]
