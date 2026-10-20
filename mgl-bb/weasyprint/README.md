# mgl-weasyprint

Standalone Cloudflare Worker + Container that turns server-built HTML into a PDF
with WeasyPrint (Pango/Cairo). It backs the **client-facing AEC design-progress
report** (`/api/projects/:id/performance-reports/:reportId/client-pdf` and the
`generate_report` MCP tool) in the MGL backend.

Mirrors `../stirling/`: a dedicated Worker, deployed on its own so MGL's CI and
Durable-Object migration list are untouched.

## How it fits together

```
MGL backend Worker ──(WEASYPRINT_SVC service binding)──▶ this Worker ──▶ Container
   builds full HTML            POST /render {html}            gunicorn+Flask+WeasyPrint
   ◀── application/pdf ────────────────────────────────────────────── PDF bytes
```

The backend assembles the **entire** bilingual HTML (inline CSS `@page`, inline
SVG charts, data-URI images). This service runs **no JavaScript** — all charts
must already be static SVG/CSS. Cyrillic fonts (Noto Sans/Serif) are baked into
the image so Mongolian glyphs render instead of `.notdef` boxes.

## Endpoints (called via the service binding)

- `POST /render` — body `{ "html": "<full document>", "base_url"?: string }` → `application/pdf`.
- `GET /health` — `200 ok`.

## Deploy

Requires the Workers **Paid** plan and Docker running locally (Wrangler builds +
pushes the image).

```sh
cd weasyprint
npm install
npx wrangler deploy
```

This deploys `mgl-weasyprint` into the same account as the MGL backend. The
backend's `WEASYPRINT_SVC` service binding (in `backend/wrangler.toml`) then
resolves to it — no public URL or API key needed.

## Notes

- WeasyPrint is pinned to **63.1**: referenced (external) SVG regressed in v64;
  we only emit inline SVG, so 63.1 is safe and deterministic.
- `instance_type = "basic"` (1 GiB) is ample. Bump to `standard-1` in
  `wrangler.toml` only if you render very large documents.
- The container scales to zero after `sleepAfter = '15m'`; the first render
  after idle pays a cold start.
