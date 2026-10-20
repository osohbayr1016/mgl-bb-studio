import { Paperclip, Trash2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/time';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { ResponsiveTable, type ResponsiveColumn } from '@/ui/responsive-table';
import { AsrRedBookBadge, AsrStatusBadge } from './AsrStatusBadge';
import {
  REPORT_TYPE_KEY,
  redBookStatusOf,
  reportTypeOf,
  usesMeetingForm,
  type AsrReport,
} from './types';

/** Оффис уулзалтад улаан дэвтэр огт хамаагүй (0367) — «Гарын үсэг дутуу» гэж улаанаар бүү сүрдүүл. */
const showRedBook = (r: AsrReport) => !usesMeetingForm(reportTypeOf(r));

/** Нөхөж бүртгэсэн ХУУЧИН тайлан (миграц 0332) — 0359-өөс багийн DASR дараалалд огноогоороо орно; файлын дугаар `legacy_doc_no`. */
function LegacyBadge({ r }: { r: Pick<AsrReport, 'origin'> }) {
  const { t } = useLanguage();
  if (r.origin !== 'legacy') return null;
  return (
    <span className="rounded-full border border-border px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
      {t('asrBackfill.legacyBadge')}
    </span>
  );
}

/**
 * Тайлангийн төрөл (0362).  «Талбайн хяналт» бол энгийн тохиолдол тул
 * шошгогүй — цахим/оффис уулзалт, зургийн өөрчлөлт л ялгарч харагдана.
 */
export function AsrTypeBadge({
  r,
}: {
  r: Pick<AsrReport, 'report_type' | 'meeting_platform'>;
}) {
  const { t } = useLanguage();
  const type = reportTypeOf(r);
  if (type === 'site') return null;
  const platform = type === 'online' ? (r.meeting_platform ?? '').trim() : '';
  return (
    <span
      className="rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0 text-[10px] font-medium text-primary"
      data-testid="asr-type-badge"
    >
      {t(REPORT_TYPE_KEY[type])}
      {platform ? ` · ${platform}` : ''}
    </span>
  );
}

/** `group_concat(t.code)` → чипүүд. */
function TeamChips({ codes }: { codes: string | null | undefined }) {
  const list = (codes ?? '').split(',').filter(Boolean);
  if (list.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((code) => (
        <span
          key={code}
          className={cn('rounded-full border px-1.5 py-0.5 text-[11px] font-medium', teamChipClass(code))}
        >
          {code}
        </span>
      ))}
    </div>
  );
}

export function AsrList({
  entries,
  onOpen,
  onDelete,
  projectNameOf,
  empty,
}: {
  entries: AsrReport[];
  onOpen: (row: AsrReport) => void;
  /** Зөвхөн админд дамжуулна — өгөгдвөл мөр бүрт устгах товч гарна. */
  onDelete?: (row: AsrReport) => void;
  /**
   * Өгвөл эхэнд «Төсөл» багана нэмэгдэнэ.  Зөвхөн бүх төслийн хөндлөн
   * жагсаалтад (`/app/asr`) хэрэгтэй — төслийн таб дотор энэ багана мөр
   * бүрт нэг л утга давтах тул зөвхөн чимээ болно.
   */
  projectNameOf?: (row: AsrReport) => string | undefined;
  empty: React.ReactNode;
}) {
  const { t } = useLanguage();

  const columns: ResponsiveColumn<AsrReport>[] = [
    ...(projectNameOf
      ? [
          {
            id: 'project',
            header: t('asr.project'),
            cell: (r: AsrReport) => (
              <span className="block max-w-[14rem] truncate text-sm">
                {projectNameOf(r) ?? '—'}
              </span>
            ),
          } satisfies ResponsiveColumn<AsrReport>,
        ]
      : []),
    {
      id: 'doc_no',
      header: t('asr.docNo'),
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {r.doc_no ? (
            <span className="font-mono text-sm">{r.doc_no}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{t('asr.docNoPending')}</span>
          )}
          <LegacyBadge r={r} />
          <AsrTypeBadge r={r} />
        </span>
      ),
    },
    {
      id: 'report_date',
      header: t('asr.reportDate'),
      cell: (r) => <span className="tabular-nums">{formatDate(r.report_date)}</span>,
    },
    {
      id: 'shifr',
      header: t('asr.shifr'),
      hideOnMobile: true,
      cell: (r) => r.shifr || <span className="text-muted-foreground">—</span>,
    },
    { id: 'teams', header: t('asr.teams'), cell: (r) => <TeamChips codes={r.team_codes} /> },
    {
      id: 'status',
      header: t('asr.status'),
      // Улаан дэвтрийн төлөв тайлангийн төлөвийн ДООР — батлагдсан ч гарын
      // үсэг дутуу тайлан жагсаалтаас шууд танигдана.
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <AsrStatusBadge status={r.status} />
          {showRedBook(r) && <AsrRedBookBadge status={redBookStatusOf(r)} />}
        </div>
      ),
    },
    {
      id: 'photos',
      header: <Paperclip className="h-3.5 w-3.5" />,
      align: 'right',
      cell: (r) =>
        r.photos.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            <Paperclip className="h-3 w-3" />
            {r.photos.length}
          </span>
        ) : null,
    },
    {
      id: 'author',
      header: t('asr.author'),
      hideOnMobile: true,
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.author_name ?? '—'}
          {r.companion_names ? (
            <span className="mt-0.5 block text-xs">{r.companion_names}</span>
          ) : null}
        </span>
      ),
    },
  ];

  if (onDelete) {
    columns.push({
      id: 'actions',
      header: '',
      align: 'right',
      // Утсанд картын мөр болж эвгүй харагдах тул нуусан — тэнд админ
      // тайланг нээгээд доод мөрөн дэх устгах товчийг ашиглана.
      hideOnMobile: true,
      cell: (r) => (
        <button
          type="button"
          aria-label={t('asr.delete')}
          title={t('asr.delete')}
          // Мөр дээр дарахад тайлан нээгддэг тул түүнийг зогсооно.
          onClick={(e) => {
            e.stopPropagation();
            onDelete(r);
          }}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    });
  }

  return (
    <ResponsiveTable
      columns={columns}
      rows={entries}
      rowKey={(r) => r.id}
      onRowClick={onOpen}
      empty={empty}
      // Утсанд ерөнхий «ШОШГО : утга» өрөлт нь тайлан тутамд 5 мөр болж
      // хэт өндөр, чимээ ихтэй карт үүсгэдэг (мөн 📎 баганын толгой нь
      // шошго болоод эвгүй харагддаг).  Тиймээс зориудын жижиг карт.
      mobileCard={(r) => (
        <div className="flex flex-col gap-2">
          {projectNameOf && (
            <span className="truncate text-xs font-medium text-muted-foreground">
              {projectNameOf(r) ?? '—'}
            </span>
          )}
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-sm font-semibold">
              {r.doc_no ?? (
                <span className="font-sans text-xs font-normal text-muted-foreground">
                  {t('asr.docNoPending')}
                </span>
              )}
            </span>
            <div className="flex flex-col items-end gap-1">
              <AsrStatusBadge status={r.status} />
              {showRedBook(r) && <AsrRedBookBadge status={redBookStatusOf(r)} />}
              <LegacyBadge r={r} />
              <AsrTypeBadge r={r} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatDate(r.report_date)}</span>
            {r.shifr && <span className="truncate">· {r.shifr}</span>}
            {r.photos.length > 0 && (
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums">
                <Paperclip className="h-3 w-3" />
                {r.photos.length}
              </span>
            )}
          </div>
          <TeamChips codes={r.team_codes} />
        </div>
      )}
    />
  );
}
