# Public preview v0.1 (ADR-054, ADR-056)

The release goal is an **online public preview**: an early preview that opens on a synthetic sample, lets anyone upload a supported plan, and checks a layout without AI. This page is the deployment and privacy record.

| Stage | Status (2026-10-18) |
| --- | --- |
| Runs locally | **Yes.** `pnpm start` serves the app on `127.0.0.1` for you alone (your `.env`, AI on with your key). This is a convenience, not the release. |
| Ready to deploy | **Yes.** The production container (`RWS_PUBLIC=1`) and the dashboard settings below (ADR-057). CI https://github.com/ritwiz06/ReplayWorldStudio/actions/runs/39175178847 passed all three jobs on `72ee6f0`, including the container on a root-owned volume (uid 10001) and the public journeys against it. |
| Staging URL | **Not created.** It needs your Railway account; I have no access to it (steps below). |
| Publicly launched | **No.** Only after the public journeys pass against the staging URL and we decide to publish it. |

## What can be published

- **The sample:** a synthetic factory hall (`fixtures/scenes/sample-factory.json`, made from `layout-checks-mm.dxf`). Machine B is selected, the aisle route is asked, and Check layout is open. Moving Machine B into the aisle turns the width-only route from clear to blocked; the before/after table compares the drawing with the layout now.
- **DXF upload:** review (floor, scale, objects, omissions) → walk, edit, compare, Check layout → save and reopen.
- **PDF page, PNG or JPEG upload:** one known length, then the floor and objects marked by hand. No AI.
- **Save:** a downloaded project file the visitor keeps.
- **Not published:** AI of any kind, DWG, accounts, shared project links (SHR-01), physics or production simulation. No claim of accuracy for real plans: none has been tried.

## Railway staging (the account-dependent steps you perform)

**Railway's documented terms (checked 2026-10-18).**
- **Config as Code (`railway.json`) is deprecated.** "New services cannot opt into Config as Code". Existing files keep working for legacy services until 2026-12-01.
  - Its replacement, `.railway/railway.ts`, is applied only by the Railway CLI (`railway config apply`) by a logged-in user.
  - So the repository carries **no Railway config file**. The settings below are entered in the dashboard once.
- **Builder.** A file named `Dockerfile` at the repository root is used automatically. The build log says `Using detected Dockerfile!`.
- **Start command.** A dashboard Start Command would *replace* the image's `ENTRYPOINT`, so leave it empty. If one is set anyway, the server refuses to run as root and the deploy fails safely.
- **Port.** Railway injects `PORT` and health-checks on it; the server listens on `PORT`.
- **Plans.** Hobby is $5/month, including $5 of usage. Beyond that: memory $10/GB/month, vCPU $20/vCPU/month, volume storage $0.15/GB/month (billed on space used), egress $0.05/GB.
- **Volumes.**
  - Hobby volumes are created at **5 GB**. They can grow (live resize) but never shrink, so **4 GB is not available on Hobby**. Trial volumes are 0.5 GB, too small for the 512 MB free-space floor: use Hobby.
  - Railway mounts volumes owned by root. Its docs suggest `RAILWAY_RUN_UID=0`; **do not set it**. The image's entrypoint gives `/data` to `rws` (uid 10001) and drops root before the server starts.
  - A service with a volume cannot have replicas, and has a short downtime on each redeploy.
  - `VOLUME` lines in a Dockerfile are refused; the image has none.
- **Client address.** Railway's edge states it in `X-Real-IP`, which the rate limits use.

**Dashboard settings for the staging service:**

| Where | Setting |
| --- | --- |
| Plan | **Hobby** |
| New Project | **Deploy from GitHub repo** → `ritwiz06/ReplayWorldStudio`, branch `main`. Name the service `staging`. |
| Settings → Source | Root Directory empty. **Wait for CI: on** (deploy only commits whose GitHub checks passed). |
| Settings → Build | Builder **Dockerfile** (detected). No custom build command, no `RAILWAY_DOCKERFILE_PATH`. |
| Settings → Deploy | **Custom Start Command: empty.** Healthcheck Path **`/health`**. Restart policy **On Failure**. **Replicas 1.** Serverless / app sleeping **off** (the 15-minute sweep needs the process running; a sleeping service would keep expired files). |
| Variables | **`PORT=8000`** only. **No `VOYAGER_API_KEY`**, no other `VOYAGER_*` or `RWS_*` values, **no `RAILWAY_RUN_UID`**, nothing from your local `.env`. |
| Volume | Right-click the canvas → **Volume** → attach to `staging`, **mount path `/data`**. Its settings show 5 GB on Hobby. |
| Backups tab | **No schedules, no manual backups.** Any backup keeps uploads past 24 hours: daily backups are kept 6 days, weekly 27, monthly 89. |
| Settings → Networking | **Generate Domain**, target port **8000**. Do not add a custom domain or share the URL. |

**Then:**
1. **Deploy.** The build log shows `Using detected Dockerfile!`. The deploy log must show one line like:

   `Public preview: running as uid 10001; data in /data (a mounted volume, 5.0 GB, … GB free); storage cap 2800 MB, refusing writes below 512 MB free; files deleted 24 h after they are stored (checked at start and every 15 min); AI off.`

   - `NOT a mounted volume` means the volume isn't attached at `/data`.
   - `uid 0` or `Refusing to run the public preview as root` means a Start Command replaced the entrypoint.
2. **Send me the URL and that log line.** I run the public journeys against it:

   ```bash
   PUBLIC_URL=https://<your-domain> pnpm --filter @replay-world/web test:e2e:public
   SCREENS_OUT=../../docs/release-0.1/staging PUBLIC_URL=https://<your-domain> pnpm --filter @replay-world/web test:e2e:public screens
   ```

   Two checks are visible only in your account: the volume's usage rising after uploads, and the deploy and HTTP logs. You can paste those, or run `railway login` and `railway link` on this computer so I can read them.
3. **Decide whether to publish.** Until then, treat the URL as staging: do not announce it.

**Expected cost:** about $5 a month (the Hobby fee) while traffic is small.
- **Memory:** about 60–75 MB idle when measured locally, roughly $0.70 a month.
- **Volume:** billed on space used, so at most $0.75 a month for 5 GB.
- **Egress:** a first visit transfers about 0.5 MB compressed, so 1,000 visits cost about $0.03.

## Storage and privacy

| What | Behaviour |
| --- | --- |
| Visitor | A random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS), kept 30 days. No account, no name, no email. |
| Uploaded files and generated models | **Stored temporarily on the server**, under `/data/visitors/<hash of the token>/`. Read and written only by requests carrying that cookie. A content hash is a file's name, never permission: another visitor gets 404 even for identical bytes. |
| Shared files | Only the synthetic sample drawings and plans in the image, read-only. |
| Retention | A file expires 24 hours after it was first stored. Uploading identical bytes again does not extend that.<br>**While the server runs**, a sweep every 15 minutes deletes expired files and empty folders, so each file is gone within 24 h 15 min.<br>**After downtime** (a redeploy, a crash, a stopped service), expired files stay on the volume, unreachable because nothing serves them, until the next start. The start-up sweep then deletes them before the first request is served.<br>"Delete my uploaded files now" in the About dialog deletes a visitor's files at once. |
| Backups | **Off, and must stay off** for the retention above to hold (step 4). |
| Projects | Never stored on the server: **Save project** downloads the file. A downloaded project reopens after its plan was deleted; the drawing panel says the original file is not on the server, and the visitor can upload the plan again. |
| Storage | **Volume 5 GB** (Hobby's size; at least 4 GB is needed). The application cap is **2800 MB** (MiB, about 2.9 GB) for all visitors' files together, counted as the disk blocks they occupy. On 5 GB that leaves about 2 GB for the filesystem's own metadata (Railway: 2–3 %), folders and uploads in flight.<br>Independently, a write is refused when it would leave **less than 512 MB free** on the volume, so a smaller volume fills safely too. Either limit answers 507, "storage is full". |
| Limits | 10 MB per plan, 15 MB per photo, 25 MB per request; 100 MB per visitor; the storage limits above; 600 requests a minute and 40 uploads per 10 minutes per client IP; a POST needs a Content-Length. |
| Logs | The server's access logs are off; it logs only start-up and errors, never bodies, file contents or keys.<br>Railway's edge keeps its own HTTP logs of request lines, so uploads send their original name in an `X-Filename` header, never in the URL. Stored files are addressed by content hash, so request lines carry no file names. |
| AI | Off. With `RWS_PUBLIC=1` the key is not read. Every AI request is refused with 503 before its body is read, and the web app shows no AI buttons. No key is in the image or the web bundle (checked in CI). |
| Server user | The HTTP server runs as `rws` (uid 10001), never as root. CI checks this with a root-owned volume, as Railway mounts one. |
| Headers | CSP (`script-src 'self' 'unsafe-eval'`, since the contract validator compiles its schemas at run time), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`. API docs (`/docs`, `/openapi.json`) are off. |

## Measured (release candidate `3f3bda0`, local container, Apple M3 Pro, headless Chromium with software WebGL)

| | |
| --- | --- |
| Image | 372 MB; builds in under 30 s with warm caches |
| First screen | DOMContentLoaded 276 ms; 517 KB transferred (main script 1.86 MB raw, 515 KB gzip) |
| Sample drawn (3D ready, software WebGL) | about 4.0 s. A GPU browser is faster; this is the slowest case |
| Idle memory / CPU | 61–75 MB / 0.4 % |
| Public journeys against the container | 5 of 5 passed in 26 s |

## Before inviting people (not done by this work)

- **Staging.** Steps 1–7 above, then the decision in step 8.
- **Newcomer trial.** Three to five people who have not seen the app try the sample, then one plan they are allowed to share; watch where they get stuck.
- **Licence.** No licence has been chosen. Visitors can use the hosted preview, but nobody may reuse the code until there is one.

## The provider-authorization question (for you to ask; not sent by us)

> Replay World Studio is a student project. I plan to host it outside ASU (Railway) as a free public preview that anyone can open without signing in. The preview currently has no AI.
>
> May a key issued to me for ASU Voyager (`https://openai.rc.asu.edu/v1`, models `qwen3-235b-a22b-instruct-2507` and `qwen3-vl-32b-instruct`) be used by that public service to answer anonymous visitors' requests? Those requests would be object descriptions, and images of floor plans that visitors upload, sent from our server to Voyager.
>
> The uploaded plans are stored temporarily on our server. Each is deleted 24 hours after upload: within 15 minutes after that while the server runs, or when it next starts after downtime. Server backups are off.
>
> If this use is not allowed, is there an approved way for a public, non-commercial preview to use Voyager, or should we use a different provider?

**Until there is a clear answer, the hosted preview has AI off and no Voyager configuration.** A later public AI path needs an independently authorized provider, with its key kept server-side.
