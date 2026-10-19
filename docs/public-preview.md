# Hosted public preview (ADR-054 to ADR-057): superseded, not deployed

> **Superseded on 2026-10-18 by ADR-058: v0.1 is local only.** Run it with `pnpm start` on `127.0.0.1`; see [local-v0.1.md](local-v0.1.md).
>
> No staging service was ever created and the app was never hosted. The Railway instructions, the cost estimate and the draft question to ASU about public use of Voyager were removed with this change. They remain in Git history, in this file at commit `c625371`.

## What remains in the code

The hosted mode stays, tested in CI, so it can be revived:
- `RWS_PUBLIC=1` in the API (`services/api/src/replay_world_api/public.py`);
- the web build flag `VITE_PUBLIC_PREVIEW=1`, which adds the "Early preview" badge and the About dialog with the hosted privacy wording;
- the `Dockerfile`, whose entrypoint drops to uid 10001;
- `pnpm --filter @replay-world/web test:e2e:public`.

The local app (`pnpm start`) is built without that flag, so it never shows the hosted wording; the local journey checks this.

## How the dormant mode behaves (`RWS_PUBLIC=1`)

| What | Behaviour |
| --- | --- |
| Visitor | A random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS), kept 30 days. No account, no name, no email. |
| Uploaded files and generated models | **Stored temporarily on the server**, under `/data/visitors/<hash of the token>/`. Read and written only by requests carrying that cookie. A content hash is a file's name, never permission: another visitor gets 404 even for identical bytes. |
| Shared files | Only the synthetic sample drawings and plans in the image, read-only. |
| Retention | A file expires 24 hours after it was first stored. Uploading identical bytes again does not extend that.<br>**While the server runs**, a sweep every 15 minutes deletes expired files and empty folders, so each file is gone within 24 h 15 min.<br>**After downtime** (a redeploy, a crash, a stopped service), expired files stay on the volume, unreachable because nothing serves them, until the next start. The start-up sweep then deletes them before the first request is served.<br>"Delete my uploaded files now" in the About dialog deletes a visitor's files at once. |
| Backups | Must be off on any host for the retention above to hold. |
| Projects | Never stored on the server: **Save project** downloads the file. A downloaded project reopens after its plan was deleted; the drawing panel says the original file is not on the server, and the visitor can upload the plan again. |
| Storage | A volume of **at least 4 GB** at `/data`. The application cap is **2800 MB** (MiB, about 2.9 GB) for all visitors' files together, counted as the disk blocks they occupy. The rest is left for the filesystem's own metadata, folders and uploads in flight.<br>Independently, a write is refused when it would leave **less than 512 MB free** on the volume, so a smaller volume fills safely too. Either limit answers 507, "storage is full". |
| Limits | 10 MB per plan, 15 MB per photo, 25 MB per request; 100 MB per visitor; the storage limits above; 600 requests a minute and 40 uploads per 10 minutes per client IP; a POST needs a Content-Length. |
| Logs | The server's access logs are off; it logs only start-up and errors, never bodies, file contents or keys.<br>A host's proxy may log request lines, so uploads send their original name in an `X-Filename` header, never in the URL. Stored files are addressed by content hash, so request lines carry no file names. |
| AI | Off. With `RWS_PUBLIC=1` the key is not read. Every AI request is refused with 503 before its body is read, and the web app shows no AI buttons. No key is in the image or the web bundle (checked in CI). |
| Server user | The HTTP server runs as `rws` (uid 10001), never as root. CI checks this with a root-owned volume. |
| Headers | CSP (`script-src 'self' 'unsafe-eval'`, since the contract validator compiles its schemas at run time), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`. API docs (`/docs`, `/openapi.json`) are off. |
