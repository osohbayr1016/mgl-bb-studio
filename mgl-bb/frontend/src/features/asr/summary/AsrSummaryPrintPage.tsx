import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { useForceLightTheme } from '@/shared/hooks/useForceLightTheme';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { AsrSummaryDocument, ASR_SUMMARY_STYLES } from './AsrSummaryDocument';
import { AsrSummaryExportButtons } from './AsrSummaryExportButtons';
import { summaryParamsFromSearch, summaryQueryString, type AsrSummaryResponse } from './summaryTypes';

/**
 * ЗХ-ийн нэгтгэл тайлангийн хэвлэх хуудас — `<Layout>`-ийн ГАДНА,
 * `<ProtectedRoute>`-ийн ДОТОР (`AsrPrintPage`-ийн ижил байрлал).
 *
 * ⚠️ ХОЁР уншигчтай: хүн өөрөө (`window.print()`) ба СЕРВЕР —
 *    `GET /author-supervision/summary/pdf` Browser Rendering-ээр ЯГ энэ хаяг
 *    руу `?t=<1 минутын токен>`-оор орж `body[data-print-ready="true"]`-ыг
 *    хүлээнэ.  Алдааны замд ч тэр тугийг тавина (25 секунд дэмий хүлээхгүй).
 */
export default function AsrSummaryPrintPage() {
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();
  useForceLightTheme();

  const params = useMemo(() => summaryParamsFromSearch(searchParams), [searchParams]);
  const qs = summaryQueryString(params);
  const { data, isLoading, isError } = useApiQuery<AsrSummaryResponse>(
    ['asr', 'summary', qs],
    `/author-supervision/summary${qs ? `?${qs}` : ''}`,
  );
  const auto = searchParams.get('auto') === '1';

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      document.body.setAttribute('data-print-ready', 'true');
      if (auto) window.print();
    };
    Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...Array.from(document.images).map((img) => img.decode().catch(() => undefined)),
    ])
      .then(() => requestAnimationFrame(() => requestAnimationFrame(done)))
      .catch(done);
    const bail = setTimeout(done, 15000);
    return () => {
      cancelled = true;
      clearTimeout(bail);
    };
  }, [data, auto]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        ref={() => document.body.setAttribute('data-print-ready', 'true')}
        className="flex min-h-screen items-center justify-center bg-white text-sm text-gray-600"
      >
        {t('asr.summary.loadFailed')}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: ASR_SUMMARY_STYLES }} />

      <div className="sum-toolbar sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2">
        <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => window.close()}>
          <ArrowLeft className="h-4 w-4" /> {t('common.close')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <AsrSummaryExportButtons params={params} data={data} />
          <Button type="button" size="sm" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('asr.print')}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto px-2 py-6 sm:px-6 print:overflow-visible print:p-0">
        <AsrSummaryDocument data={data} t={t} />
      </div>
    </div>
  );
}
