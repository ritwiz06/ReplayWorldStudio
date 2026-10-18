# Public preview v0.1 (ADR-054)

The first public version: an **early preview** that opens on a synthetic sample, lets anyone upload a supported plan, and checks a layout without AI. This page is the deployment and privacy record.

## What can be published

- **The sample:** a synthetic factory hall (`fixtures/scenes/sample-factory.json`, made from `layout-checks-mm.dxf`). Machine B is selected, the aisle route is asked, and Check layout is open. Moving Machine B into the aisle turns the width-only route from clear to blocked; the before/after table compares the drawing with the layout now.
- **DXF upload:** review (floor, scale, objects, omissions) → walk, edit, compare, Check layout → save and reopen.
- **PDF page, PNG or JPEG upload:** one known length, then the floor and objects marked by hand. No AI.
- **Save:** a downloaded project file the visitor keeps.
- **Not published:** AI of any kind, DWG, accounts, shared project links (SHR-01), physics or production simulation. No claim of accuracy for real plans: none has been tried.

## Railway setup (the one-time steps you perform)

Railway's documented limits (checked 2026-10-18):
- **Hobby plan:** $5/month, which includes $5 of usage.
- **Usage beyond that:** memory $10/GB/month, vCPU $20/vCPU/month, volume storage $0.15/GB/month, egress $0.05/GB.
- **Volumes on Hobby:** at most 5 GB, one volume per service, no replicas with a volume.
- **Redeploys:** a short downtime on each redeploy of a service with a volume.

1. **Create the project.** Sign up for Railway on the Hobby plan, then **New Project → Deploy from GitHub repo → `ritwiz06/ReplayWorldStudio`**. Railway reads `railway.json`: the `Dockerfile` builder, a health check at `/health`, restart on failure.
2. **Volume:** on the service, **Add Volume**, mount path **`/data`**, 1 GB (raise it later if needed; it cannot be shrunk).
3. **Variables:** none are required; the image sets `RWS_PUBLIC=1`, `RWS_DATA_DIR=/data`, `RWS_WEB_DIR`, `RWS_TRUST_PROXY=1` and listens on Railway's `PORT`.
   - **Do not add `VOYAGER_API_KEY`.** The public build ignores it anyway, but it does not belong on the service.
   - If the first deploy logs a permission error writing `/data` (the image runs as a non-root user), add `RAILWAY_RUN_UID=0`, as Railway's volume docs advise.
4. **Backups:** leave the volume's backup schedules **off**. They are opt-in. Railway keeps daily backups 6 days, weekly 27 and monthly 89, so turning one on would break the "deleted after 24 hours" statement. If you ever enable one, change the wording in `AboutPreview.tsx` and the README first.
5. **Domain:** **Settings → Networking → Generate Domain**. HTTPS on `*.up.railway.app` is handled by Railway.
6. **Replicas:** keep **1**. Volumes do not allow more, and the request limits are per process.
7. **Verify the staging URL** from this repository:

   ```bash
   PUBLIC_URL=https://<your-domain> pnpm --filter @replay-world/web test:e2e:public
   SCREENS_OUT=../../docs/release-0.1/staging PUBLIC_URL=https://<your-domain> pnpm --filter @replay-world/web test:e2e:public screens
   ```

**Expected cost:** about $5 a month, the Hobby fee, while traffic is small.
- **Measured locally:** the container idles at about 60–75 MB of memory and under 1 % of one CPU, roughly $0.70 of memory a month.
- **Volume:** 1 GB is $0.15 a month.
- **Egress:** a first visit transfers about 0.5 MB (compressed), so 1,000 visits are about $0.03.
- A burst of PDF uploads raises memory for a few seconds (rendering a page).

## Storage and privacy

| What | Behaviour |
| --- | --- |
| Visitor | A random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS), kept 30 days. No account, no name, no email. |
| Uploaded files and generated models | Stored under `/data/visitors/<hash of the token>/`. Read and written only by requests carrying that cookie. A content hash is a file's name, never permission: another visitor gets 404 even for identical bytes. |
| Shared files | Only the synthetic sample drawings and plans in the image, read-only. |
| Retention | Each file is deleted 24 hours after it was stored. A sweep runs at start-up and every 15 minutes, and empty folders go too. "Delete my uploaded files now" in the About dialog deletes them at once. |
| Backups | None enabled; see step 4. |
| Projects | Never stored on the server: **Save project** downloads the file. A downloaded project reopens after its plan was deleted; the drawing panel says the original file is not on the server, and the visitor can upload the plan again. |
| Limits | 10 MB per plan, 15 MB per photo, 25 MB per request; 100 MB per visitor; 3000 MB for the preview (507 when full); 600 requests a minute and 40 uploads per 10 minutes per client IP; a POST needs a Content-Length. |
| Logs | Access logs are off in the preview (request lines would carry uploaded files' names); only start-up and errors are logged, never bodies, file contents or keys. |
| AI | Off. With `RWS_PUBLIC=1` the key is not read; the AI endpoints answer 503 and the web app shows no AI buttons. |
| Headers | CSP (`script-src 'self' 'unsafe-eval'`, since the contract validator compiles its schemas at run time), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`. API docs (`/docs`, `/openapi.json`) are off. |

## Measured (local container, Apple M3 Pro, headless Chromium with software WebGL)

| | |
| --- | --- |
| Image | 372 MB; builds in under 30 s with warm caches |
| First screen | DOMContentLoaded 276 ms; 517 KB transferred (main script 1.86 MB raw, 515 KB gzip) |
| Sample drawn (3D ready, software WebGL) | about 4.0 s. A GPU browser is faster; this is the slowest case |
| Idle memory / CPU | 61–75 MB / 0.4 % |
| Public journeys against the container | 5 of 5 passed in 26 s |

## Before inviting people (not done by this work)

- **Staging.** Create the Railway service (steps above) and run the journeys against its URL.
- **Newcomer trial.** Three to five people who have not seen the app try the sample, then one permitted plan; watch where they get stuck.
- **Licence.** The repository has no licence chosen. Visitors can use the hosted preview, but nobody may reuse the code until one is chosen.

## The provider-authorization question (for you to ask; not sent by us)

> Replay World Studio is a student project hosted outside ASU (Railway) as a free public preview that anyone can open without signing in. May a key issued to me for ASU Voyager (`https://openai.rc.asu.edu/v1`, models `qwen3-235b-a22b-instruct-2507` and `qwen3-vl-32b-instruct`) be used by that public service to answer anonymous visitors' requests? These are object descriptions and images of floor plans they upload, sent from our server and never stored by us. If not, is there an approved way for a public, non-commercial preview to use Voyager, or should we use a different provider?

Until there is a clear answer, the public build has AI off. A later public AI path needs an independently authorized provider; its key stays server-side.
