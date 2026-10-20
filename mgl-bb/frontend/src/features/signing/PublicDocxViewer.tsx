import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';

/**
 * Login-гүй гарын үсгийн хуудсанд «Баримт бичиг» (Drive)-ийн Word баримтыг утсан дээр харуулна
 * (0397).  Байт нь Drive-ын ОДООГИЙН файл (`/public/signing/:token/document`), зурсны дараа —
 * зурсан агшны хуулбар; Google хөрвүүлэлт, серверийн PDF рендер ХЭРЭГГҮЙ.
 *
 *   • render = `docx-preview` (ажилтны «Баримт бичиг»-ийн харагдацтай ижил сан, ~1 MB — зөвхөн
 *     энд lazy ачаалагдана); navy дэвсгэр дээрх «Автомат» текстийг Word шиг цагаан болгоно
 *     (`docxAutoText` — зөвхөн харагдац, файл хөндөгдөхгүй).
 *   • утсанд A4 хуудас (≈794px) багтахгүй — CSS `zoom`-оор өргөнд багтаана (layout-ын өндөр
 *     зөв, гүйлгэлт хэвийн); «Томруулах» нь 100% болгож хэвтээ гүйлгэнэ.
 *   • `focusText` — зурагчийн мөрийн үүргийн бичвэртэй нүдийг тодруулж, товчоор тийш гүйлгэнэ.
 */

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string; terminal: boolean };

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('mn-MN');

/**
 * «Захиалагчаас баталсан: (Approved by client)» → «захиалагчаасбаталсан» — нүдний текстийн эхлэлтэй тулгана.
 * Зайг БҮРЭН хасна: docx-preview нүдний догол мөрүүдийг (<p>) зайгүй нийлүүлдэг тул
 * «Prepared by:» + «Бэлтгэсэн:» нь textContent-д «Prepared by:Бэлтгэсэн:» болдог (бодит RFI-д хэмжсэн).
 */
function roleProbe(text: string): string {
  return norm(text.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[:：]\s*$/, '')).replace(/\s+/g, '');
}

export function PublicDocxViewer({
  src,
  focusText,
  focusLabel,
  onFocusFound,
}: {
  src: string;
  /** Тодруулах мөрийн үүргийн бичвэр (баримт дээрх). */
  focusText?: string | null;
  focusLabel?: string;
  /** Тодруулах нүд олдсон эсэх — эцэг «мөр рүү очих» товчоо харуулна. */
  onFocusFound?: (scrollToFocus: (() => void) | null) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  /** Хуудас нь харах талбараас өргөн (утас) — «Томруулах» товч хэрэгтэй. */
  const [overflows, setOverflows] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef<HTMLDivElement | null>(null);
  const pageWidth = useRef(0);
  const focusEl = useRef<HTMLElement | null>(null);

  const recompute = useCallback(() => {
    const host = hostRef.current;
    if (!host || pageWidth.current <= 0) return;
    const avail = host.clientWidth - 16;
    setOverflows(avail < pageWidth.current);
    setScale(fit ? Math.min(1, Math.max(0.25, avail / pageWidth.current)) : 1);
  }, [fit]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const body = bodyRef.current;
    const style = styleRef.current;
    if (!body || !style) return;
    body.replaceChildren();
    style.replaceChildren();
    pageWidth.current = 0;
    focusEl.current = null;
    onFocusFound?.(null);
    void (async () => {
      try {
        const res = await fetch(src, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) {
            setState({
              kind: 'error',
              message: payload.error || 'Баримтыг нээхэд алдаа гарлаа',
              terminal: res.status === 404 || res.status === 410 || res.status === 413,
            });
          }
          return;
        }
        let blob = await res.blob();
        try {
          const { fixDocxBlob } = await import('@/features/projects/drive/docxAutoText');
          blob = (await fixDocxBlob(blob)).blob;
        } catch {
          // Харагдацын засвар л — эх байтаар үргэлжилнэ.
        }
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        await renderAsync(blob, body, style, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });
        if (cancelled) return;
        // Хуудасны байгалийн өргөн (zoom-гүй) — нэг удаа хэмжинэ.
        let widest = 0;
        body.querySelectorAll<HTMLElement>('section.docx').forEach((sec) => {
          widest = Math.max(widest, sec.offsetWidth);
        });
        pageWidth.current = widest || 794;

        if (focusText) {
          const probe = roleProbe(focusText);
          if (probe.length >= 3) {
            const cells = body.querySelectorAll<HTMLElement>('td');
            for (const cell of cells) {
              if (roleProbe(cell.textContent ?? '').startsWith(probe)) {
                cell.setAttribute('data-sign-focus', 'true');
                focusEl.current = cell;
                break;
              }
            }
          }
        }
        setState({ kind: 'ready' });
        onFocusFound?.(
          focusEl.current
            ? () => focusEl.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            : null,
        );
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.error('[public-signing] docx render failed', err);
        setState({ kind: 'error', message: 'Баримтыг энэ төхөөрөмж дээр харуулж чадсангүй', terminal: false });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // onFocusFound нь эцгийн setState — тогтвортой; focusText/src солигдоход л дахин render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, attempt, focusText]);

  useLayoutEffect(() => {
    if (state.kind === 'ready') recompute();
  }, [state.kind, recompute]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(host);
    return () => ro.disconnect();
  }, [recompute]);

  return (
    <div>
      <div
        ref={hostRef}
        className="relative max-h-[62dvh] min-h-[320px] overflow-auto bg-muted/40 p-2 sm:max-h-[720px]"
        style={{ WebkitOverflowScrolling: 'touch' }}
        tabIndex={0}
        aria-label="Баримтын урьдчилан харах"
      >
        {state.kind === 'loading' && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/60 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Баримтыг бэлтгэж байна…
            </span>
          </div>
        )}
        {state.kind === 'error' && (
          <div role="alert" className="grid h-72 place-items-center px-4 text-center">
            <div className="space-y-3">
              <p className="text-sm text-foreground">{state.message}</p>
              {!state.terminal && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setState({ kind: 'loading' });
                    setAttempt((n) => n + 1);
                  }}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Дахин оролдох
                </Button>
              )}
            </div>
          </div>
        )}
        <div ref={styleRef} />
        <div ref={zoomRef} style={{ zoom: scale }} className={state.kind === 'error' ? 'hidden' : undefined}>
          {/* docx-preview хуудас бүрийг цагаан, сүүдэртэй гаргадаг — гадна талд саарал дэвсгэр л. */}
          <div
            ref={bodyRef}
            className="[&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-0 [&_section.docx]:mb-3 [&_td[data-sign-focus]]:outline [&_td[data-sign-focus]]:outline-[3px] [&_td[data-sign-focus]]:outline-offset-[-3px] [&_td[data-sign-focus]]:outline-primary"
            aria-label={focusLabel}
          />
        </div>
      </div>
      {state.kind === 'ready' && (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-micro text-muted-foreground">
          <span>Хоёр хуруугаар томруулж, доош гүйлгэж бүтнээр нь шалгана уу.</span>
          {overflows && (
            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={() => setFit((v) => !v)}>
              {fit ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
              {fit ? 'Томруулах' : 'Багтаах'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
