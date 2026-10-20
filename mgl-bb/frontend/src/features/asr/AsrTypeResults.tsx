import { useState } from 'react';
import { HardHat, Loader2 } from 'lucide-react';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { AsrList } from '@/features/projects/asr/AsrList';
import { useAsrReportsByType } from '@/features/projects/asr/api';
import { REPORT_TYPE_KEY, type AsrReport, type AsrReportType } from '@/features/projects/asr/types';
import { ASR_TYPE_ICON } from './lib/typeIcons';

const PAGE_SIZE = 50;

/**
 * `/app/asr`-д ТӨРӨЛ сонгосон үед — бүх төслийн тэр төрлийн тайлангууд (шинэ нь
 * эхэндээ), төслийн нэртэй.  Нэг товчоор шүүсний үр дүн; мөр дээр дарвал тайлан
 * нээгдэнэ.  Ноорог нь үзэгчийн харах эрхээр орж, төлөвийн шошготой гарна.
 *
 * ⚠️ `key={type}`-аар дуудна — төрөл солигдоход «Цааш» хуудаслалт 1-р хуудсаас эхэлнэ.
 */
export function AsrTypeResults({
  type,
  onOpenReport,
}: {
  type: AsrReportType;
  onOpenReport: (row: AsrReport) => void;
}) {
  const { t } = useLanguage();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useAsrReportsByType(
    type,
    limit,
  );
  const Icon = ASR_TYPE_ICON[type];
  const entries = data?.entries ?? [];
  // Товчны тоо (`/stats` `by_type`) ноорог тоолдоггүй; жагсаалтад үзэгчийн ноорог орно —
  // толгойд хоёуланг нь тусад нь харуулбал товчтой зөрөхгүй.
  const drafts = entries.filter((e) => e.status === 'draft').length;
  const sent = entries.length - drafts;
  // `AsrList.projectNameOf` нь `AsrReport` авдаг; хөндлөн жагсаалтын `project_name` тэнд байхгүй тул id-аар.
  const nameById = new Map(entries.map((e) => [e.id, e.project_name]));

  return (
    <section className="space-y-3" data-testid="asr-type-results" data-type={type}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">{t(REPORT_TYPE_KEY[type])}</h2>
        {data && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('asr.colReportsN', { n: `${sent}${data.has_more ? '+' : ''}` })}
            {drafts > 0 && ` · ${drafts} ${t('asr.statusDraft').toLowerCase()}`}
          </span>
        )}
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="flex justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <AsrList
          entries={entries}
          onOpen={onOpenReport}
          projectNameOf={(r) => asrProjectName(nameById.get(r.id)) ?? undefined}
          empty={
            <EmptyState icon={HardHat} title={t('asr.empty')} description={t('asr.emptyHint')} />
          }
        />
      )}

      {data?.has_more && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPlaceholderData}
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
          >
            {t('reportsPage.showMore', { n: PAGE_SIZE })}
          </Button>
        </div>
      )}
    </section>
  );
}
