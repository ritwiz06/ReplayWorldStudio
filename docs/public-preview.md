# Public preview v0.1 (ADR-054, ADR-056)

The release goal is an **online public preview**: an early preview that opens on a synthetic sample, lets anyone upload a supported plan, and checks a layout without AI. This page is the deployment and privacy record.

| Stage | Status (2026-10-18) |
| --- | --- |
| Runs locally | **Yes.** `pnpm start` serves the app on `127.0.0.1` for you alone (your `.env`, AI on with your key). This is a convenience, not the release. |
| Ready to deploy | **Yes, pending CI on the correction.** The production container (`RWS_PUBLIC=1`) and `railway.json`; the public journeys pass against the container. |
| Staging URL | **Not created.** Needs your Railway account (steps below). |
| Publicly launched | **No.** Only after the public journeys pass against the staging URL and we decide to publish it. |

## What can be published

- **The sample:** a synthetic factory hall (`fixtures/scenes/sample-factory.json`, made from `layout-checks-mm.dxf`). Machine B is selected, the aisle route is asked, and Check layout is open. Moving Machine B into the aisle turns the width-only route from clear to blocked; the before/after table compares the drawing with the layout now.
- **DXF upload:** review (floor, scale, objects, omissions) → walk, edit, compare, Check layout → save and reopen.
- **PDF page, PNG or JPEG upload:** one known length, then the floor and objects marked by hand. No AI.
- **Save:** a downloaded project file the visitor keeps.
- **Not published:** AI of any kind, DWG, accounts, shared project links (SHR-01), physics or production simulation. No claim of accuracy for real plans: none has been tried.

## Railway staging (the account-dependent steps you perform)

Railway's documented terms (checked 2026-10-18):
- **Hobby plan:** $5/month, which includes $5 of usage. Beyond that, memory $10/GB/month, vCPU $20/vCPU/month, volume storage $0.15/GB/month, egress $0.05/GB.
- **Volumes on Hobby:** at most 5 GB; they can be grown (live resize), never shrunk. A service with a volume cannot have replicas and has a short downtime on each redeploy.
- **Dockerfiles may not declare `VOLUME`** (that was the "Dockerfile failed validation" error); the image no longer does.
- **Volumes are mounted owned by root.** Railway suggests `RAILWAY_RUN_UID=0`; **do not set it**. The image's entrypoint starts as root only to give `/data` to the user `rws` (uid 10001), then drops privileges before the HTTP server starts, and the server refuses to run as root.

1. **Create the service.** On the Hobby plan: **New Project → Deploy from GitHub repo → `ritwiz06/ReplayWorldStudio`**. Railway reads `railway.json`:
   - the `Dockerfile` builder;
   - a volume required at `/data` (a deploy without one fails);
   - one replica, a health check at `/health`, and restart on failure.
2. **Volume.** On the service, **Add Volume**, mount path **`/data`**. Open its settings and make sure it is **4 GB** (live-resize up to 4 GB if it is smaller; 5 GB is also fine). The application's storage cap is sized for 4 GB; see Storage below.
3. **Variables:** none are required. The image sets `RWS_PUBLIC=1`, `RWS_DATA_DIR=/data`, `RWS_WEB_DIR` and `RWS_TRUST_PROXY=1`, and it listens on Railway's `PORT`.
   - **Do not add `VOYAGER_API_KEY`**, or any Voyager setting. The public build ignores the key anyway, but it does not belong on the hosted service.
   - **Do not add `RAILWAY_RUN_UID`.**
4. **Backups: leave them all off.** Railway keeps daily backups 6 days, weekly 27 and monthly 89. Any schedule would keep uploads past 24 hours and make the stated retention false.
5. **Deploy, then read the deploy log.** It must contain one line like:

   `Public preview: running as uid 10001; data in /data (4.0 GB volume, … GB free); storage cap 2800 MB, refusing writes below 512 MB free; files deleted 24 h after they are stored (checked at start and every 15 min); AI off.`

   - If it says `uid 0`, or the log reads `Refusing to run the public preview as root`, stop: something overrode the entrypoint.
   - If it warns that the cap exceeds the volume, grow the volume.
6. **Domain:** **Settings → Networking → Generate Domain**. Railway provides HTTPS on `*.up.railway.app`.
7. **Run the public journeys against the staging URL** from this repository:

   ```bash
   PUBLIC_URL=https://<your-domain> pnpm --filter @replay-world/web test:e2e:public
   SCREENS_OUT=../../docs/release-0.1/staging PUBLIC_URL=https://<your-domain> pnpm --filter @replay-world/web test:e2e:public screens
   ```

8. **Decide whether to publish.** Until then, treat the URL as staging: do not announce it.

**Expected cost:** about $5 a month (the Hobby fee) while traffic is small.
- **Memory:** about 60–75 MB idle when measured locally, roughly $0.70 a month.
- **Volume:** 4 GB is at most $0.60 a month.
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
| Storage | **Volume 4 GB.** The application cap is **2800 MB** (MiB, about 2.9 GB) for all visitors' files together, counted as the disk blocks they occupy. That leaves about 1.1 GB for the filesystem's own overhead, folders and uploads in flight.<br>Independently, a write is refused when it would leave **less than 512 MB free** on the volume, so a smaller volume fills safely too. Either limit answers 507, "storage is full". |
| Limits | 10 MB per plan, 15 MB per photo, 25 MB per request; 100 MB per visitor; the storage limits above; 600 requests a minute and 40 uploads per 10 minutes per client IP; a POST needs a Content-Length. |
| Logs | Access logs are off in the preview (request lines would carry uploaded files' names); only start-up and errors are logged, never bodies, file contents or keys. |
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
