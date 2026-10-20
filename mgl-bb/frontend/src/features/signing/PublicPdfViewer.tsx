import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Button } from '@/ui/button';

/**
 * Серверт рендерлэсэн (read-only) PDF-ийг хуудас хуудсаар нь canvas дээр харуулна.
 *
 * ЯАГААД iframe БИШ:
 *   • COOP/COEP `credentialless` дор HTTP-ээр ачаалсан PDF iframe-д Chrome-ын viewer ажилладаггүй;
 *   • iOS Safari iframe дахь PDF-ийн зөвхөн 1-р хуудсыг гүйлгэх боломжгүй харуулдаг;
 *   • Android Chrome PDF-ийг iframe-д огт зурдаггүй.
 * pdf.js (legacy build — iOS 15+) нь бүгдэд ижил, pinch-zoom хэвийн ажиллана.
 *
 * Эх файлыг засах боломжгүй — зөвхөн зураг.  «Томоор нээх» нь шинэ tab (top-level
 * navigation → COEP үйлчлэхгүй, хөтчийн өөрийн PDF viewer).
 */

type Loaded = { doc: PDFDocumentProxy; pages: number; aspect: number };
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; loaded: Loaded }
  | { kind: 'error'; message: string; terminal: boolean };

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function PdfPage({ doc, index, width, aspect }: { doc: PDFDocumentProxy; index: number; width: number; aspect: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(index === 0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || width < 50) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (width * dpr) / base.width });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.aspectRatio = `${base.width} / ${base.height}`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        task = page.render({ canvas, canvasContext: ctx, viewport });
        await task.promise;
      } catch (err) {
        // RenderingCancelledException — өргөн солигдох үед хэвийн.
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error('[public-signing] pdf page render failed', err);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, width, visible]);

  return (
    <div ref={hostRef} className="mx-auto w-full" style={{ aspectRatio: String(aspect) }}>
      <canvas ref={canvasRef} className="block h-auto w-full rounded-sm bg-white shadow-sm ring-1 ring-black/10" />
    </div>
  );
}

export function PublicPdfViewer({
  src,
  openHref,
  loadingText = 'Баримтыг бэлтгэж байна…',
  onLoaded,
}: {
  src: string;
  openHref: string;
  /** Сервер PDF-ийг анх удаа үүсгэх үед хэдэн секунд болно — тэр үеийн бичвэр. */
  loadingText?: string;
  /** PDF амжилттай ачаалагдсан (жишээ нь «Татах» товчийг идэвхжүүлэх). */
  onLoaded?: () => void;
}) {
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) * 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    // pdf.js (~1 MB) ба баримтыг ЗЭРЭГ татна — өмнө нь PDF ирсний ДАРАА л сангаа
    // татаж эхэлдэг байсан (2026-10-12, «маш удаан»).
    const pdfjsReady = loadPdfjs();
    pdfjsReady.catch(() => undefined);
    void (async () => {
      try {
        const res = await fetch(src, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setState({
            kind: 'error',
            message: body.error || 'Баримтыг урьдчилан харахад алдаа гарлаа',
            terminal: res.status === 404 || res.status === 410,
          });
          return;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await pdfjsReady;
        const task = pdfjs.getDocument({ data: bytes });
        loadingTask = task;
        const doc = await task.promise;
        if (controller.signal.aborted) return;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setState({ kind: 'ready', loaded: { doc, pages: doc.numPages, aspect: vp.width / vp.height } });
        onLoadedRef.current?.();
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[public-signing] pdf load failed', err);
        setState({ kind: 'error', message: 'Баримтыг энэ төхөөрөмж дээр харуулж чадсангүй', terminal: false });
      }
    })();
    return () => {
      controller.abort();
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
    };
  }, [src, attempt]);

  return (
    <div>
      <div
        ref={scrollRef}
        className="max-h-[62dvh] min-h-[320px] overflow-y-auto bg-muted/40 p-2 min-[360px]:p-3 sm:max-h-[720px]"
        style={{ WebkitOverflowScrolling: 'touch' }}
        tabIndex={0}
        aria-label="Баримтын урьдчилан харах"
      >
        {state.kind === 'loading' && (
          <div className="grid h-72 place-items-center text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> {loadingText}
            </span>
          </div>
        )}

        {state.kind === 'error' && (
          <div role="alert" className="grid h-72 place-items-center px-4 text-center">
            <div className="space-y-3">
              <p className="text-sm text-foreground">{state.message}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {!state.terminal && (
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                      setState({ kind: 'loading' });
                      setAttempt((n) => n + 1);
                    }}>
                    <RefreshCw className="mr-1.5 h-4 w-4" /> Дахин оролдох
                  </Button>
                )}
                {!state.terminal && (
                  <Button asChild type="button" variant="outline" size="sm">
                    <a href={openHref} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1.5 h-4 w-4" /> Томоор нээх
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {state.kind === 'ready' && (
          <div className="space-y-3">
            {Array.from({ length: state.loaded.pages }, (_, i) => (
              <PdfPage key={i} doc={state.loaded.doc} index={i} width={width} aspect={state.loaded.aspect} />
            ))}
          </div>
        )}
      </div>
      {state.kind === 'ready' && state.loaded.pages > 1 && (
        <p className="border-t px-4 py-2 text-center text-micro text-muted-foreground">
          Нийт {state.loaded.pages} хуудас — доош гүйлгэж бүгдийг нь шалгана уу.
        </p>
      )}
    </div>
  );
}
