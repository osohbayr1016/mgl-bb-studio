"""WeasyPrint PDF renderer for the MGL client design-progress report.

POST /render  {"html": "<full HTML document>", "base_url": "..."?}  -> application/pdf
GET  /health  -> 200 "ok"

The MGL backend (backend/src/lib/weasyprint.ts) assembles the entire bilingual
HTML (inline CSS @page + inline SVG charts + data-URI images) and posts it here;
this service is a thin, stateless HTML->PDF transform. NO JavaScript is executed
— every chart must already be static SVG/CSS.
"""
from flask import Flask, request, Response
from weasyprint import HTML

app = Flask(__name__)

# Cap the rendered HTML; the Worker builds it, so this is just a safety bound.
MAX_HTML_BYTES = 8 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024


@app.get("/health")
def health():
    return Response("ok", mimetype="text/plain")


@app.post("/render")
def render():
    data = request.get_json(silent=True) or {}
    html = data.get("html")
    if not isinstance(html, str) or not html.strip():
        return Response('{"error":"missing html"}', status=400,
                        mimetype="application/json")
    if len(html.encode("utf-8")) > MAX_HTML_BYTES:
        return Response('{"error":"html too large"}', status=413,
                        mimetype="application/json")

    base_url = data.get("base_url")
    if not isinstance(base_url, str):
        base_url = None

    try:
        pdf = HTML(string=html, base_url=base_url).write_pdf()
    except Exception as exc:  # noqa: BLE001 — surface render errors to the Worker
        msg = str(exc).replace('"', "'")[:500]
        return Response('{"error":"render failed","detail":"' + msg + '"}',
                        status=500, mimetype="application/json")
 
    return Response(
        pdf,
        mimetype="application/pdf",
        headers={"Content-Disposition": 'inline; filename="report.pdf"'},
    )
