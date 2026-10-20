/**
 * Гаднын хүний гарын үсэгтэй «Баримт бичиг»-ийн Word баримтыг PDF болгох хуудас
 * (`/sign/:token/print?r=<түр эрх>`, 0397, 2026-10-12).
 *
 * Хүн ЭНЭ хуудсыг нээдэггүй: сервер (Browser Rendering) нээж, `data-print-ready` болмогц PDF
 * болгоод хувийн bucket-д кэшлэнэ — зурсан хүн зөвхөн тэр PDF-ийг харж, татна (засварлах .docx
 * түүнд очихгүй).  Эх .docx-ийг `r` (сервер өгсөн 3 минутын эрх) байж л авна; эрхгүй бол алдаа.
 *
 * Алдаа гарвал `data-print-error` тавина — сервер тэр хуудсыг PDF болгож КЭШЛЭХГҮЙ.
 * Login, Layout, ProtectedRoute-ийн ГАДНА (ажилтны `DrivePrintPage`-тэй ижил зурах дүрэм — `docxPrint.ts`).
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DOCX_PRINT_STYLES, renderDocxForPrint, waitForPrintAssets } from '@/features/projects/drive/docxPrint';
import { publicDocumentSourceUrl } from './publicSigningApi';

function markDone(error?: string) {
  if (error) document.body.setAttribute('data-print-error', error);
  document.body.setAttribute('data-print-ready', 'true');
}

export default function PublicSigningPrintPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const grant = params.get('r') ?? '';
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    document.body.removeAttribute('data-print-ready');
    document.body.removeAttribute('data-print-error');

    void (async () => {
      try {
        if (!token || !grant) throw new Error('missing_grant');
        const res = await fetch(publicDocumentSourceUrl(token, grant), { cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error(`source_${res.status}`);
        const raw = await res.blob();
        const body = bodyRef.current;
        const style = styleRef.current;
        if (cancelled || !body || !style) return;
        await renderDocxForPrint(raw, body, style);
        if (cancelled) return;
        if (!body.querySelector('section.docx')) throw new Error('empty_render');
        await waitForPrintAssets(body);
        if (!cancelled) markDone();
      } catch (err) {
        if (cancelled) return;
        const code = err instanceof Error ? err.message : 'render_failed';
        console.error('[public-signing-print]', err);
        setError(code);
        markDone(code);
      }
    })();
    return () => {
      cancelled = true;
      meta.remove();
    };
  }, [token, grant]);

  return (
    <div className="min-h-screen bg-white">
      <style>{DOCX_PRINT_STYLES}</style>
      {error && <p className="p-8 text-center text-sm text-neutral-700">Баримтыг бэлтгэж чадсангүй ({error}).</p>}
      <div ref={styleRef} />
      <div ref={bodyRef} className="drive-print-doc print-area" />
    </div>
  );
}
