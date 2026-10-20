import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Crosshair,
  Download,
  Eraser,
  ExternalLink,
  FileText,
  Loader2,
  PenLine,
  Redo2,
  ShieldCheck,
  Undo2,
  XCircle,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Button } from '@/ui/button';
import {
  fetchSigningPayload,
  pingPresence,
  PublicSigningError,
  publicDocumentUrl,
  submitPublicSignature,
  type PublicSigningPayload,
} from './publicSigningApi';
import { PublicDocxViewer } from './PublicDocxViewer';
import { PublicPdfViewer } from './PublicPdfViewer';

/** docx link: зурагчийн хуудас нээлттэй гэдгийг ажилтны цонхонд мэдэгдэх давтамж. */
const PRESENCE_MS = 20_000;
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

function prettyDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat('mn-MN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Token URL-д байдаг тул Referer-ээр гоожихгүй, хайлтад индексжихгүй. */
function usePrivatePageHead() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Гарын үсэг зурах';
    const added: HTMLMetaElement[] = [];
    for (const [name, content] of [
      ['robots', 'noindex, nofollow, noarchive'],
      ['referrer', 'no-referrer'],
    ] as const) {
      const m = document.createElement('meta');
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
      added.push(m);
    }
    return () => {
      document.title = prevTitle;
      for (const m of added) m.remove();
    };
  }, []);
}

function CompanyHeader({ company }: { company: PublicSigningPayload['company'] | null }) {
  return (
    <header className="border-b bg-background/95 px-4 pb-3 pt-[calc(12px+env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-border">
          {/* logo.svg нь 1920×1080 тавцан дээрх жижиг тэмдэг — тавцангаас томруулж хайчилна */}
          <img src="/logo.svg" alt="" className="h-full w-full scale-[3.4] object-contain" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{company?.name ?? 'MGL E&C'}</div>
          {company?.tagline && <div className="truncate text-xs text-muted-foreground">{company.tagline}</div>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 text-micro text-success">
          <ShieldCheck className="h-4 w-4" /> <span className="hidden min-[360px]:inline">Хамгаалагдсан link</span>
        </div>
      </div>
    </header>
  );
}

function StatusCard({
  company,
  tone,
  title,
  children,
}: {
  company: PublicSigningPayload['company'] | null;
  tone: 'success' | 'neutral' | 'warn';
  title: string;
  children: ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warn' ? Clock : XCircle;
  const color = tone === 'success' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-muted-foreground';
  return (
    <main className="min-h-dvh bg-muted/30 pb-[env(safe-area-inset-bottom)]">
      <CompanyHeader company={company} />
      <div className="px-4 py-8 sm:py-14">
        <section role="status" className="mx-auto max-w-lg rounded-2xl border bg-background p-6 text-center shadow-sm">
          <Icon className={`mx-auto mb-4 h-12 w-12 ${color}`} />
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="mt-2 space-y-1 text-sm leading-6 text-muted-foreground">{children}</div>
        </section>
      </div>
    </main>
  );
}

const CONTACT_HINT = 'Шинэ link авахын тулд танд энэ баримтыг илгээсэн ажилтантай холбогдоно уу.';

/**
 * Login-гүй, хугацаатай bearer link-ээр RFI/CR эсвэл ЗХ тайланд гарын үсэг зурах хуудас.
 * Mobile-first: баримт босоо, зурах талбар хуруунд тохирсон том, илгээх товч бүтэн өргөнтэй.
 * Token нь НЭГ баримт + НЭГ гарын үсгийн мөрөнд л хүчинтэй.
 */
export default function PublicSigningPage() {
  usePrivatePageHead();
  const { token = '' } = useParams();
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [payload, setPayload] = useState<PublicSigningPayload | null>(null);
  const [signerName, setSignerName] = useState('');
  const [consent, setConsent] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [padHistory, setPadHistory] = useState({ canUndo: false, canRedo: false });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSigned, setJustSigned] = useState<{ name: string; at: string; preview: boolean; pdf: boolean } | null>(null);
  /** Зурсны дараах PDF ачаалагдсан — «Татах» тэр үед л идэвхжинэ (сервер PDF-ийг анх удаа үүсгэж байхад давхар рендер үгүй). */
  const [signedPdfReady, setSignedPdfReady] = useState(false);
  const onSignedPdfLoaded = useCallback(() => setSignedPdfReady(true), []);
  const [signerPosition, setSignerPosition] = useState('');
  const [scrollToFocus, setScrollToFocus] = useState<(() => void) | null>(null);
  const [signatureInView, setSignatureInView] = useState(false);
  const onFocusFound = useCallback((fn: (() => void) | null) => setScrollToFocus(() => fn), []);
  const isDocx = payload?.document?.format === 'docx';
  const pending = payload?.request.status === 'pending' && !justSigned;

  // docx: «яг одоо нээлттэй» — ажилтны цонхонд бодит цагаар.  Хооронд нь цуцлагдвал хуудас шинэчлэгдэнэ.
  useEffect(() => {
    if (!token || !isDocx || !pending) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const status = await pingPresence(token);
      if (stopped || !status || status === 'pending') return;
      try {
        setPayload(await fetchSigningPayload(token));
      } catch {
        // дараагийн удаа
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), PRESENCE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, isDocx, pending]);

  // Доод талын «Гарын үсэг зурах» товч — гарын үсгийн хэсэг харагдаж байвал нуугдана.
  useEffect(() => {
    if (!pending) return;
    const el = document.getElementById('signature-section');
    if (!el) return;
    const io = new IntersectionObserver((entries) => setSignatureInView(entries.some((e) => e.isIntersecting)), {
      threshold: 0.15,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [pending, loading]);

  useEffect(() => {
    if (!token) {
      setLoadError({ message: 'Гарын үсгийн link дутуу байна', status: 404 });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchSigningPayload(token, controller.signal)
      .then((data) => {
        setPayload(data);
        setSignerName((prev) => prev || data.request.signer_name_hint || '');
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError({
          message: err instanceof Error ? err.message : String(err),
          status: err instanceof PublicSigningError ? err.status : 0,
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token]);

  const canSubmit = hasInk && signerName.trim().length > 0 && consent && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    const signature = padRef.current?.toPngDataUrl();
    if (!signature) {
      setSubmitError('Гарын үсгээ зурна уу.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await submitPublicSignature(token, {
        signature_data_url: signature,
        signer_name: signerName.trim(),
        ...(isDocx && signerPosition.trim() ? { signer_position: signerPosition.trim() } : {}),
        consent: true,
      });
      setJustSigned({
        name: result.signed_name,
        at: result.signed_at,
        preview: result.signed_preview === true,
        pdf: result.signed_format === 'pdf',
      });
    } catch (err) {
      if (err instanceof PublicSigningError && (err.status === 409 || err.status === 410)) {
        // Link хаагдсан / өөр хүн зурсан — хуудсыг бодит төлөвөөр дахин ачаална.
        try {
          setPayload(await fetchSigningPayload(token));
        } catch {
          setLoadError({ message: err.message, status: err.status });
        }
        return;
      }
      setSubmitError(err instanceof Error ? err.message : 'Гарын үсэг хадгалахад алдаа гарлаа');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/30">
        <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Баримтыг нээж байна…
        </div>
      </main>
    );
  }

  if (!payload) {
    return (
      <StatusCard company={null} tone="neutral" title="Link нээгдсэнгүй">
        <p>{loadError?.message ?? 'Link хүчингүй эсвэл хугацаа дууссан байна.'}</p>
        {loadError?.status !== 0 && <p>{CONTACT_HINT}</p>}
      </StatusCard>
    );
  }

  const { request, company, document: doc } = payload;

  if (justSigned || request.status === 'signed') {
    const name = justSigned?.name ?? request.signed_name;
    const at = justSigned?.at ?? request.signed_at;
    const preview = doc?.format === 'docx' && (justSigned ? justSigned.preview : doc.signed_preview === true);
    // Зурсны дараа ЗӨВХӨН PDF (засварлах .docx зурсан хүнд очихгүй — 2026-10-12).  Хуучин worker
    // (`signed_format`-гүй) .docx буцаадаг тул тэр үед л Word viewer.
    const asPdf = justSigned ? justSigned.pdf : doc?.signed_format === 'pdf';
    const pdfName = (doc?.file_name ?? 'document.docx').replace(/\.docx$/i, '') + '.pdf';
    if (preview && doc) {
      // Word баримт: гарын үсэг ЯГ тэр файлд суусан — зурсан хувилбарыг шууд харуулна.
      return (
        <main className="min-h-dvh bg-muted/30 pb-[calc(24px+env(safe-area-inset-bottom))]">
          <CompanyHeader company={company} />
          <div className="mx-auto max-w-5xl space-y-3 px-2 py-3 sm:space-y-4 sm:px-5 sm:py-6">
            <section role="status" className="rounded-2xl border border-success/30 bg-background p-4 text-center shadow-sm sm:p-5">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-success" />
              <h1 className="text-lg font-semibold">Гарын үсэг баримтад суулаа</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {[name, request.role_label, at ? prettyDate(at) : null].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Таны гарын үсэг «{doc.title}» баримтын эх файлд орж, манай баримт бичгийн санд шинэчлэгдлээ. Энэ хуудсыг
                хааж болно.
              </p>
            </section>
            <section className="overflow-hidden rounded-2xl border bg-background shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{asPdf ? 'Гарын үсэгтэй баримт (PDF)' : 'Гарын үсэгтэй баримт'}</h2>
                <div className="flex shrink-0 items-center gap-1">
                  {!asPdf && scrollToFocus && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 gap-1 px-2 text-xs text-primary"
                      onClick={() => scrollToFocus()}
                    >
                      <Crosshair className="h-4 w-4" /> Миний мөр
                    </Button>
                  )}
                  {asPdf && !signedPdfReady ? (
                    <Button type="button" size="sm" className="h-9 gap-1.5" disabled data-testid="public-sign-download">
                      <Download className="h-4 w-4" /> PDF татах
                    </Button>
                  ) : (
                    <Button type="button" size="sm" className="h-9 gap-1.5" asChild data-testid="public-sign-download">
                      <a
                        href={publicDocumentUrl(token, { download: true })}
                        download={(asPdf ? pdfName : doc.file_name) ?? undefined}
                      >
                        <Download className="h-4 w-4" /> {asPdf ? 'PDF татах' : 'Татах'}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
              {/* `key` ЗААВАЛ: зурахын өмнөх харагдац мод дахь ИЖИЛ байрлалд байгаа тул React
                  нөгөө instance-ийг дахин ашиглаж (src ижил) гарын үсэггүй хуучин баримтыг үлдээдэг. */}
              {asPdf ? (
                <PublicPdfViewer
                  key="signed-pdf"
                  src={publicDocumentUrl(token)}
                  openHref={publicDocumentUrl(token)}
                  loadingText="Гарын үсэгтэй баримтыг PDF болгож байна…"
                  onLoaded={onSignedPdfLoaded}
                />
              ) : (
                <PublicDocxViewer
                  key="signed"
                  src={publicDocumentUrl(token)}
                  focusText={doc.slot?.role ?? null}
                  focusLabel={request.role_label}
                  onFocusFound={onFocusFound}
                />
              )}
            </section>
          </div>
        </main>
      );
    }
    return (
      <StatusCard company={company} tone="success" title="Гарын үсэг амжилттай баталгаажлаа">
        {doc && (
          <p className="font-medium text-foreground">
            {doc.document_type}
            {doc.document_no ? ` · ${doc.document_no}` : ''}
          </p>
        )}
        <p>
          {[name, request.role_label, at ? prettyDate(at) : null].filter(Boolean).join(' · ')}
        </p>
        <p>Баримт системд хадгалагдлаа. Энэ хуудсыг хааж болно.</p>
      </StatusCard>
    );
  }

  if (request.status === 'expired') {
    return (
      <StatusCard company={company} tone="warn" title="Link-ийн хугацаа дууссан">
        <p>{CONTACT_HINT}</p>
      </StatusCard>
    );
  }
  if (request.status === 'revoked') {
    return (
      <StatusCard company={company} tone="neutral" title="Link цуцлагдсан">
        <p>{CONTACT_HINT}</p>
      </StatusCard>
    );
  }
  if (!doc) {
    return (
      <StatusCard company={company} tone="neutral" title="Баримт олдсонгүй">
        <p>{CONTACT_HINT}</p>
      </StatusCard>
    );
  }

  const documentSrc = publicDocumentUrl(token);
  const slot = isDocx ? doc.slot : undefined;
  const slotWho = slot ? [slot.position, slot.name].filter(Boolean).join(' · ') : '';
  const goToSignature = () => {
    document.getElementById('signature-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="min-h-dvh bg-muted/30 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <CompanyHeader company={company} />

      <div className="mx-auto max-w-5xl space-y-3 px-2 py-3 sm:space-y-4 sm:px-5 sm:py-6">
        <section className="rounded-2xl border bg-background p-3 shadow-sm min-[360px]:p-4 sm:p-5">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{doc.document_type}</p>
              <h1 className="mt-0.5 break-words text-lg font-semibold leading-snug">{doc.title}</h1>
              <p className="mt-1 break-words text-sm text-muted-foreground">{doc.project_name}</p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{isDocx ? 'Файл' : 'Баримтын №'}</dt>
              <dd className="mt-0.5 break-words font-medium">{isDocx ? (doc.file_name ?? '—') : (doc.document_no ?? '—')}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Огноо</dt>
              <dd className="mt-0.5 font-medium">{prettyDate(doc.document_date)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{isDocx ? 'Илгээсэн' : 'Бэлтгэсэн'}</dt>
              <dd className="mt-0.5 break-words font-medium">{doc.prepared_by ?? '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Албан тушаал</dt>
              <dd className="mt-0.5 break-words font-medium">{doc.prepared_by_position ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-background shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Баримттай танилцах</h2>
              <p className="text-xs text-muted-foreground">Гарын үсэг зурахаасаа өмнө баримтыг бүтнээр нь шалгана уу.</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-2">
              {isDocx ? (
                scrollToFocus && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 gap-1 px-2 text-xs font-medium text-primary"
                    onClick={() => scrollToFocus()}
                  >
                    <Crosshair className="h-4 w-4" /> Миний мөр
                  </Button>
                )
              ) : (
                <a
                  href={documentSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" /> Томоор нээх
                </a>
              )}
              <a
                href="#signature-section"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('signature-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary hover:underline"
              >
                <PenLine className="h-4 w-4" /> Гарын үсэг рүү
              </a>
            </div>
          </div>
          {isDocx ? (
            <PublicDocxViewer
              key="current"
              src={documentSrc}
              focusText={slot?.role ?? null}
              focusLabel={request.role_label}
              onFocusFound={onFocusFound}
            />
          ) : (
            <PublicPdfViewer src={documentSrc} openHref={documentSrc} />
          )}
        </section>

        <section id="signature-section" className="scroll-mt-3 rounded-2xl border bg-background p-3 shadow-sm min-[360px]:p-4 sm:p-5">
          <div className="mb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">Таны гарын үсгийн мөр</p>
            <h2 className="mt-1 break-words text-lg font-semibold">{request.role_label}</h2>
            {slot && (slot.role || slotWho) && (
              <p className="mt-1 break-words text-xs text-muted-foreground">
                Баримт дээр: {[slot.role, slotWho].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Доорх цагаан талбарт хуруу, stylus эсвэл mouse-аар гарын үсгээ зурна уу. Талбарын гадна хуруугаар гүйлгэхэд
              хуудас хэвийн хөдөлнө.
            </p>
          </div>

          <label className="block text-sm font-medium">
            Овог нэр
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              maxLength={160}
              autoComplete="name"
              enterKeyHint="done"
              placeholder="Гарын үсэг зурж буй хүний нэр"
              className="mt-1.5 h-12 w-full rounded-xl border bg-background px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {isDocx && doc.ask_position && (
            <label className="mt-3 block text-sm font-medium">
              Албан тушаал <span className="font-normal text-muted-foreground">(заавал биш)</span>
              <input
                value={signerPosition}
                onChange={(e) => setSignerPosition(e.target.value)}
                maxLength={120}
                autoComplete="organization-title"
                enterKeyHint="done"
                placeholder="Жишээ: Захиалагчийн төлөөлөгч"
                className="mt-1.5 h-12 w-full rounded-xl border bg-background px-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
          )}

          <div className="mt-4 overflow-hidden rounded-2xl border-2 border-dashed border-muted-foreground/30 bg-white p-1">
            <SignaturePad
              ref={padRef}
              disabled={busy}
              onInkChange={setHasInk}
              onHistoryChange={setPadHistory}
              label="Гарын үсэг зурах талбар"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-xs text-muted-foreground">
              {hasInk ? 'Гарын үсэг орсон' : 'Гарын үсэг зураагүй байна'}
              <span className="hidden sm:inline"> · Буруу зурвал Ctrl+Z (⌘Z)</span>
            </span>
            <div className="flex items-center gap-1">
              {/* Утсанд товчлуургүй — буцаах/дахин хийх товч заавал (Ctrl+Z / Ctrl+Y ч ажиллана). */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 gap-1.5 px-3"
                onClick={() => padRef.current?.undo()}
                disabled={!padHistory.canUndo || busy}
                title="Буцаах (Ctrl+Z)"
                data-testid="public-sign-undo"
              >
                <Undo2 className="h-4 w-4" /> Буцаах
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 px-2.5"
                onClick={() => padRef.current?.redo()}
                disabled={!padHistory.canRedo || busy}
                title="Дахин хийх (Ctrl+Y)"
                aria-label="Дахин хийх"
                data-testid="public-sign-redo"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 gap-1.5 px-3"
                onClick={() => padRef.current?.clear()}
                disabled={!hasInk || busy}
              >
                <Eraser className="h-4 w-4" /> Арилгах
              </Button>
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/20 p-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-5 w-5 shrink-0 accent-current"
            />
            <span className="leading-5">
              Би дээрх баримттай бүтнээр нь танилцсан бөгөөд энэ гарын үсгийг өөрөө зурж, <strong>{request.role_label}</strong>{' '}
              нэршлээр баталгаажуулж байна.
            </span>
          </label>

          {submitError && (
            <div role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {submitError}
            </div>
          )}

          <Button
            type="button"
            className="mt-4 h-auto min-h-12 w-full gap-2 whitespace-normal rounded-xl px-3 py-2.5 text-base"
            disabled={!canSubmit}
            onClick={submit}
            aria-busy={busy}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <PenLine className="h-5 w-5" />}
            {busy ? 'Баталгаажуулж байна…' : 'Гарын үсэг зурж баталгаажуулах'}
          </Button>
          {!canSubmit && !busy && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {[!signerName.trim() && 'нэрээ бичих', !hasInk && 'гарын үсэг зурах', !consent && 'зөвшөөрлөө тэмдэглэх']
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <p className="mt-3 text-center text-micro leading-4 text-muted-foreground">
            Link хүчинтэй хугацаа: {prettyDate(request.expires_at)} · Гарын үсэг зурмагц дахин ашиглах боломжгүй.
            {isDocx && ' Гарын үсэг баримтын эх файлд шууд суна.'}
          </p>
        </section>
      </div>

      {/* Утсан дээр баримт урт — гарын үсгийн хэсэг рүү үргэлж нэг товшилтоор. */}
      {!signatureInView && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:hidden">
          <Button type="button" className="h-12 w-full gap-2 rounded-xl text-base" onClick={goToSignature} data-testid="public-sign-cta">
            <PenLine className="h-5 w-5" /> Гарын үсэг зурах
          </Button>
        </div>
      )}
    </main>
  );
}
