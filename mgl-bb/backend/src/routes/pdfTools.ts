import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireAdmin } from '../middleware/auth';
import { stirlingEnabled, stirlingEditorUrl, runPipeline, type PdfOp } from '../lib/stirling';

// /api/pdf-tools - Stirling-PDF passthrough for the report editor.
//   GET  /config   -> { enabled, editorUrl }  (drives the UI)
//   POST /process  -> multipart file (+ optional ops JSON) -> processed PDF
// The Worker cannot host Stirling; it proxies to a separate instance configured
// via STIRLING_BASE_URL / STIRLING_API_KEY. When unset the feature is dormant.

const pdfTools = new Hono<{ Bindings: Env; Variables: AppVariables }>();

pdfTools.get('/config', (c) => {
  return c.json({
    enabled: stirlingEnabled(c.env),
    editorUrl: stirlingEditorUrl(c.env),
  });
});

pdfTools.post('/process', requireAdmin(), async (c) => {
  if (!stirlingEnabled(c.env)) {
    return c.json({ error: 'PDF editor is not configured (STIRLING_BASE_URL).' }, 503);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'multipart/form-data required' }, 400);
  }

  // form.get() is typed as string | null in the Worker lib, but at runtime an
  // uploaded file is a Blob/File. Reject strings/null, then treat it as a Blob.
  const entry = form.get('file');
  if (entry === null || typeof entry === 'string') {
    return c.json({ error: 'file field required' }, 400);
  }
  const file = entry as unknown as Blob & { name?: string };

  let ops: PdfOp[] = [{ op: 'compress' }];
  const opsRaw = form.get('ops');
  if (typeof opsRaw === 'string' && opsRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(opsRaw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      ops = parsed as PdfOp[];
    } catch {
      return c.json({ error: 'ops must be a JSON array of PdfOp' }, 400);
    }
  }

  const inputName = file.name && file.name.trim() ? file.name : 'report.pdf';
  const inputBytes = new Uint8Array(await file.arrayBuffer());

  try {
    const out = await runPipeline(c.env, inputBytes, ops, inputName);
    const outName = inputName.replace(/\.pdf$/i, '') + '_edited.pdf';
    return new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[pdf-tools] Stirling pipeline failed', err);
    return c.json(
      { error: 'PDF processing failed', detail: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

export default pdfTools;
