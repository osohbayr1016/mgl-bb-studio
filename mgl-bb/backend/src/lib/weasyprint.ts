import type { Env } from '../types';

/* ============================================================================
 * WeasyPrint HTML->PDF client
 * ----------------------------------------------------------------------------
 * WeasyPrint (https://weasyprint.org) is a Pango/Cairo HTML->PDF engine that
 * CANNOT run on the Worker itself (it binds native .so libraries via CFFI). It
 * lives in a dedicated container Worker (weasyprint/) reached through the
 * `WEASYPRINT_SVC` service binding — internal, no public hop, no API key.
 *
 * The Worker assembles the ENTIRE bilingual HTML (inline CSS @page + inline SVG
 * charts + data-URI images) and posts it here; WeasyPrint runs no JavaScript,
 * so every chart must already be static SVG/CSS. Mirrors lib/stirling.ts.
 * ========================================================================== */

/** True when the WeasyPrint container service binding is configured. */
export function weasyprintEnabled(env: Env): boolean {
  return !!env.WEASYPRINT_SVC;
}

/**
 * Render a full HTML document to PDF bytes via the WeasyPrint container.
 * Throws when the binding is missing or the container returns a non-2xx.
 */
export async function renderPdf(env: Env, html: string): Promise<Uint8Array> {
  if (!env.WEASYPRINT_SVC) throw new Error('WeasyPrint is not configured (WEASYPRINT_SVC)');

  // Service binding: the host is arbitrary; only the path reaches the container
  // Worker, which proxies it to gunicorn/Flask. No API key (never leaves Cloudflare).
  const res = await env.WEASYPRINT_SVC.fetch('https://weasyprint-svc/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`WeasyPrint /render → HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
