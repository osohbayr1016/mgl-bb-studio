import { FileSpreadsheet, Loader2, Search } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

export type DashSort = 'count' | 'category' | 'family' | 'type';
export type DashView = 'summary' | 'bars' | 'table' | 'rooms' | 'schedules';

const SORT_OPTIONS: { value: DashSort; labelKey: string }[] = [
  { value: 'count', labelKey: 'qtoPage.colCount' },
  { value: 'category', labelKey: 'qtoPage.colCategory' },
  { value: 'family', labelKey: 'qtoPage.colFamily' },
  { value: 'type', labelKey: 'qtoPage.colType' },
];

const VIEW_OPTIONS: { value: DashView; labelKey: string }[] = [
  { value: 'summary', labelKey: 'qtoPage.dashViewSummary' },
  { value: 'bars', labelKey: 'qtoPage.dashViewBars' },
  { value: 'table', labelKey: 'qtoPage.dashViewTable' },
  { value: 'rooms', labelKey: 'qtoPage.dashViewRooms' },
  { value: 'schedules', labelKey: 'qtoPage.dashViewSchedules' },
];

function SegmentedGroup<T extends string>({
  options,
  value,
  onChange,
  t,
}: {
  options: { value: T; labelKey: string }[];
  value: T;
  onChange: (v: T) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="inline-flex divide-x overflow-hidden rounded-md border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'px-2.5 py-1.5 font-mono text-label transition-colors',
            value === o.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/50',
          )}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  );
}

/** Нэг мөр удирдлага: хайлт · эрэмбэ · view солигч · Excel export. */
export function DashboardToolbar({
  query,
  onQuery,
  sort,
  onSort,
  view,
  onView,
  onExport,
  exportProgress,
  exportDisabled,
}: {
  query: string;
  onQuery: (q: string) => void;
  sort: DashSort;
  onSort: (s: DashSort) => void;
  view: DashView;
  onView: (v: DashView) => void;
  onExport: () => void;
  /** null = сул; string = «n/N» явц (олон файлын татаж буй дугаарлалт). */
  exportProgress: string | null;
  exportDisabled: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('qtoPage.dashSearchPlaceholder')}
          className="h-8 pl-8"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="font-mono text-label text-muted-foreground">
          {t('qtoPage.dashSortLabel')}
        </span>
        <SegmentedGroup options={SORT_OPTIONS} value={sort} onChange={onSort} t={t} />
      </div>

      <SegmentedGroup options={VIEW_OPTIONS} value={view} onChange={onView} t={t} />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto"
        disabled={exportDisabled || exportProgress != null}
        onClick={onExport}
      >
        {exportProgress != null ? (
          <>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            {t('qtoPage.dashExportPreparing')} {exportProgress}
          </>
        ) : (
          <>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            {t('qtoPage.exportXlsx')}
          </>
        )}
      </Button>
    </div>
  );
}
