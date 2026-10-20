import { Paperclip, Trash2, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { AsrRedBookBadge, AsrStatusBadge } from '@/features/projects/asr/AsrStatusBadge';
import {
  REPORT_TYPE_KEY,
  redBookStatusOf,
  reportTypeOf,
  type AsrReport,
} from '@/features/projects/asr/types';
import { ASR_TYPE_ICON } from '../lib/typeIcons';
import { countSiteVisits, groupByMonth, teamCodesOf } from '../lib/asrBoard';
import { monthLabel, weekdayShort } from './rangeText';

/**
 * Тайлангууд ОН ЦАГИЙН дарааллаар, САРААР бүлэглэсэн — мөр бүр «хэзээ,
 * ямар төрөл, аль баг, хэн (хамт хэн), ямар төлөвтэй» гэдгийг нэг мөрөнд.
 * Сарын толгой дээрх «Зөвхөн энэ сар» нь хугацааг тэр сар болгоно.
 */
export function AsrReportTimeline({
  entries,
  nameOf,
  onOpen,
  onDelete,
  onPickMonth,
}: {
  entries: AsrReport[];
  nameOf: (userId: number) => string | undefined;
  onOpen: (row: AsrReport) => void;
  onDelete?: (row: AsrReport) => void;
  /** Өгвөл сарын толгойд «Зөвхөн энэ сар» товч гарна. */
  onPickMonth?: (year: number, month: number) => void;
}) {
  const { t } = useLanguage();
  const groups = groupByMonth(entries);

  return (
    <div className="space-y-4" data-testid="asr-report-timeline">
      {groups.map((g) => (
        <section key={g.key} className="overflow-hidden rounded-xl border border-border bg-card" data-month={g.key}>
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-4 py-2.5">
            <h3 className="text-sm font-semibold">{monthLabel(g.year, g.month, t)}</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              <span>
                {t('asr.board.monthStats', { n: g.reports.length, visits: countSiteVisits(g.reports) })}
              </span>
              {onPickMonth && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => onPickMonth(g.year, g.month)}
                  className="h-auto px-0 pointer-coarse:h-auto"
                >
                  {t('asr.board.viewMonth')}
                </Button>
              )}
            </div>
          </header>
          <ul className="divide-y">
            {g.reports.map((r) => (
              <li key={r.id} className="flex items-stretch">
                <TimelineRow r={r} nameOf={nameOf} onOpen={onOpen} />
                {onDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={t('asr.delete')}
                    title={t('asr.delete')}
                    onClick={() => onDelete(r)}
                    className="hidden h-auto shrink-0 rounded-none px-3 text-muted-foreground hover:bg-danger/10 hover:text-danger pointer-coarse:h-auto sm:flex"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TimelineRow({
  r,
  nameOf,
  onOpen,
}: {
  r: AsrReport;
  nameOf: (userId: number) => string | undefined;
  onOpen: (row: AsrReport) => void;
}) {
  const { t } = useLanguage();
  const type = reportTypeOf(r);
  const TypeIcon = ASR_TYPE_ICON[type];
  const platform = type === 'online' ? (r.meeting_platform ?? '').trim() : '';
  const teams = teamCodesOf(r);
  const author = formatDisplayName(r.author_name ?? nameOf(r.author_id) ?? '');
  const companions = companionNames(r, nameOf);
  const day = Number(r.report_date.slice(8, 10));

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onOpen(r)}
      className="h-auto whitespace-normal font-normal pointer-coarse:h-auto motion-safe:active:scale-100 min-w-0 flex-1 items-start justify-start gap-3 rounded-none px-3 py-3 text-left hover:bg-accent/30 hover:text-foreground has-[>svg]:px-3 sm:px-4"
      data-testid="asr-timeline-row"
      data-report={r.id}
    >
      <div className="flex w-11 shrink-0 flex-col items-center rounded-md border bg-muted/40 py-1 text-center">
        <span className="text-lg font-semibold leading-tight tabular-nums">{day}</span>
        <span className="text-label font-normal normal-case leading-none tracking-normal text-muted-foreground">
          {weekdayShort(r.report_date, t)}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <TypeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t(REPORT_TYPE_KEY[type])}
            {platform && <span className="font-normal text-muted-foreground">· {platform}</span>}
          </span>
          {r.doc_no ? (
            <span className="font-mono text-xs text-muted-foreground">{r.doc_no}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{t('asr.docNoPending')}</span>
          )}
          {r.origin === 'legacy' && (
            <span className="rounded-full border border-border px-1.5 text-label font-medium normal-case tracking-normal text-muted-foreground">
              {t('asrBackfill.legacyBadge')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {teams.map((code) => (
            <span
              key={code}
              className={cn('rounded-full border px-1.5 py-0.5 text-label font-medium tracking-normal', teamChipClass(code))}
            >
              {code}
            </span>
          ))}
          <span className="inline-flex min-w-0 items-center gap-1">
            <Users className="size-3.5 shrink-0" aria-hidden />
            <span className="font-medium text-foreground">{author || '—'}</span>
            {companions && (
              <span className="truncate">· {t('asr.board.withCompanions', { names: companions })}</span>
            )}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <AsrStatusBadge status={r.status} />
        {r.status !== 'draft' && <AsrRedBookBadge status={redBookStatusOf(r)} />}
        {r.photos.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
            title={t('asr.board.photos', { n: r.photos.length })}
          >
            <Paperclip className="size-3" aria-hidden />
            {r.photos.length}
          </span>
        )}
      </div>
    </Button>
  );
}

/** Хамт явсан хүмүүсийн нэр — зохиогчийг давхар бичихгүй. */
function companionNames(r: AsrReport, nameOf: (userId: number) => string | undefined): string {
  const ids = (r.companion_ids ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== r.author_id);
  if (ids.length > 0) {
    const names = ids.map((id) => nameOf(id)).filter((n): n is string => !!n);
    if (names.length === ids.length) return names.map(formatDisplayName).join(', ');
  }
  // Нэрийн толь дутуу бол серверийн бэлэн мөрийг хэвээр.
  return r.companion_names ?? '';
}
