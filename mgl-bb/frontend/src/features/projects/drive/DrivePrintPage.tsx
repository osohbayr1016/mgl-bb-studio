/**
 * «Баримт бичиг» дээрх Word баримтыг ХЭВЛЭХ / PDF болгох хуудас
 * (`/app/drive-print/:scope/:id/:fileId`, эзний хүсэлт 2026-10-01: «гарын
 * үсгээ зурсан RFI-г хэвлэх, PDF болгоод өөр газар руу явуулах»).
 *
 * `<Layout>`-ийн ГАДНА, `<ProtectedRoute>`-ийн ДОТОР (ASR-ийн хэвлэх хуудастай
 * ижил).  Drive-аас эх байтыг серверээр дамжуулан татаж (`…/content`), navy
 * дэвсгэрийн «Автомат» бичвэрийг Word шиг цагаан болгоод (`docxAutoText.ts`,
 * эх файл хөндөгдөхгүй) `docx-preview`-ээр A4 хуудсаар зурна — Word-ийн
 * хадгалсан хуудасны хил (`lastRenderedPageBreak`) хэрэглэгдэнэ.  Дараа нь
 * хөтчийн хэвлэх цонх АВТОМАТААР нээгдэнэ: принтер, эсвэл «Хадгалах: PDF».
 * PDF-ийн өгөгдмөл нэр = баримтын нэр (`document.title`).
 *
 * ⚠️ Word-оор хэвлэсэнтэй пиксел бүрээр ижил БИШ: үсгийн фонт (AGFutura Mon
 *    суугаагүй компьютерт Word-ийн адил Calibri), тэмдэгтийн 90% шахалт
 *    (`w:w`) хөтөчид алга.  Албан ёсны хэвлэлийг Word-оор хийх бол файлыг
 *    татаж аваад нээнэ — гарын үсэг ФАЙЛ ДЭЭР суусан тул тэнд ч ижил.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileWarning, Loader2, Printer } from 'lucide-react';
import { Button } from '@/ui/button';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { useLanguage } from '@/shared/i18n';
import { fetchDriveFile, fetchDrivePreviewBlob } from './api';
import { DOCX_PRINT_STYLES, renderDocxForPrint, waitForPrintAssets } from './docxPrint';
import { describeDriveError } from './driveErrors';
import { isDocxFile } from './fileKind';
import type { DriveScope } from './types';

const SCOPES: readonly DriveScope[] = ['project', 'main'];

export default function DrivePrintPage() {
  const { scope: rawScope, id: rawId, fileId = '' } = useParams<{ scope: string; id: string; fileId: string }>();
  const { t } = useLanguage();
  useForceLightTheme();
  const scope = (SCOPES as readonly string[]).includes(rawScope ?? '') ? (rawScope as DriveScope) : null;
  const id = Number(rawId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const printedRef = useRef(false);
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error'; name: string; error?: string }>({
    phase: 'loading',
    name: '',
  });

  useEffect(() => {
    if (!scope || !Number.isInteger(id) || id <= 0 || !fileId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const meta = await fetchDriveFile(scope, id, fileId);
        const item = meta.item;
        if (!isDocxFile(item.mime_type, item.name)) throw new Error(t('docSign.printOnlyDocx'));
        const raw = await fetchDrivePreviewBlob(scope, id, fileId);
        const body = bodyRef.current;
        const style = styleRef.current;
        if (cancelled || !body || !style) return;
        await renderDocxForPrint(raw, body, style);
        if (cancelled) return;
        // PDF-ийн өгөгдмөл нэр — «260930_EVGR_RFI_020.pdf».
        document.title = item.name.replace(/\.docx$/i, '');
        setState({ phase: 'ready', name: item.name });
        // Фонт, зураг бүрэн ачаалагдсаны дараа НЭГ удаа хэвлэх цонх.
        await waitForPrintAssets(body);
        document.body.setAttribute('data-print-ready', 'true');
        if (!printedRef.current && !cancelled) {
          printedRef.current = true;
          window.setTimeout(() => window.print(), 150);
        }
      } catch (err) {
        if (cancelled) return;
        const view = describeDriveError(err);
        setState({ phase: 'error', name: '', error: err instanceof Error && err.message ? err.message : t(view.key) });
        document.body.setAttribute('data-print-ready', 'true');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [scope, id, fileId, t]);

  const backHref = scope ? `/app/documents/${scope}/${id}` : '/app/documents';

  return (
    <div className="min-h-screen">
      <style>{DOCX_PRINT_STYLES}</style>
      <div className="drive-print-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Button size="sm" variant="ghost" asChild>
          <Link to={backHref}>
            <ArrowLeft className="h-4 w-4" /> {t('docSign.printBack')}
          </Link>
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{state.name}</span>
        <span className="hidden text-xs text-muted-foreground md:inline">{t('docSign.printHint')}</span>
        <Button size="sm" onClick={() => window.print()} disabled={state.phase !== 'ready'} data-testid="drive-print-now">
          <Printer className="h-4 w-4" /> {t('docSign.printNow')}
        </Button>
      </div>
      {state.phase === 'loading' && scope && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> {t('docSign.printPreparing')}
        </div>
      )}
      {(state.phase === 'error' || !scope) && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <FileWarning className="h-6 w-6" />
          <p>{state.error ?? t('docSign.printOnlyDocx')}</p>
        </div>
      )}
      <div ref={styleRef} />
      <div ref={bodyRef} className="drive-print-doc print-area" />
    </div>
  );
}
