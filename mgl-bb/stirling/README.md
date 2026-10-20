# mgl-stirling — Stirling-PDF on Cloudflare Containers

A standalone Worker that runs the [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)
Docker image as a Cloudflare Container. The MGL backend calls it (compress / page
numbers / watermark / merge / password) from `/api/pdf-tools/process`, and staff
can open its web UI for manual edits.

It is intentionally **separate** from the MGL backend Worker so MGL's CI deploy
and Durable-Object migration list are untouched.

## Requirements
- **Workers Paid plan** (Containers are not on the free tier).
- **Docker running locally** (or in CI) when you run `wrangler deploy` — Wrangler
  builds and pushes the image.

## Deploy
```bash
cd stirling
npm install
npx wrangler deploy        # Docker must be running; first deploy takes a few min
```
After the first deploy, wait a few minutes for the container to be provisioned.
Check status with `npx wrangler containers list`.

## How MGL connects
- **API (internal):** MGL's `backend/wrangler.toml` has a `[[services]]` binding
  `STIRLING_SVC -> mgl-stirling`. The pipeline calls this Worker over that binding
  — no public hop, no API key. Nothing else to configure for the headless ops.
- **Manual editor (public):** the "PDF засах" button opens this Worker's public URL
  (`https://mgl-stirling.<your-subdomain>.workers.dev`). Set that URL in MGL's
  `STIRLING_PUBLIC_URL` var to show the button; leave it empty to hide it.

  ⚠ The public URL exposes the full Stirling UI. Put **Cloudflare Access** in front
  of it (Zero Trust → Access → Applications) so only your staff can reach it.

## Tuning cost vs. capability
- Default: full image on `standard-1` (4 GiB) — every op works.
- Cheaper: set the Dockerfile tag to `:latest-ultra-lite` and `instance_type = "basic"`
  (1 GiB) in `wrangler.toml`. Supports pdfbox ops (page-numbers, watermark, merge,
  stamp, password) but NOT compress / OCR / office-conversions.
- `sleepAfter` in `src/index.ts` controls how long an idle instance stays warm
  (scales to zero after). Lower = cheaper, more cold starts (~1–3s each).
