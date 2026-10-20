import { useState } from 'react';
import { CheckCircle2, Link2, Plus, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { PolishableTextarea } from '@/ui/PolishableTextarea';
import { useAsrPreviousIssues } from './api';
import { DocBand, DocBlock, DocHead, DocText } from './AsrDocKit';
import { tableDate, templateTeamLabel } from './asrTemplate';
import type { AsrChange } from './AsrEditor';
import type {
  AsrFormState,
  AsrIssueSource,
  AsrReport,
  AsrResolution,
  AsrTeamOption,
} from './types';

/**
 * «Ажлын тайлан» блок (миграц 0336) — БАРИМТЫН хэлбэрээр (2026-09-25): хар-хөх
 * тууз → багийн чагтны мөр → нэг хүрээтэй бие, дотор нь тод-налуу дэд
 * гарчигтай ГУРВАН асуулт.  Хэвлэх баримт (`AsrDocument.tsx`) яг энэ
 * дарааллаар зурна:
 *
 *   1. Талбай дээр өгсөн үүрэг даалгавар
 *   2. Илэрсэн алдаа, дутагдал   (+ энэ тайланг ШИЙДСЭН дараагийн тайлангууд —
 *      сервер гарган авдаг, зөвхөн уншина)
 *   3. Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн — `resolutions` мөрүүд
 *
 * ⚠️ Ерөнхий бичвэр (`work_report`) ба баг тус бүрийн «Ажлын тайлан»
 *    (0133-ын `work_note`) ХАСАГДСАН (эзний хүсэлт 2026-09-28: «ерөнхий
 *    тайлбарыг хасаж, 3 асуултаа л үлдээ»).  Багана, API, хэвлэлт ХЭВЭЭР:
 *    текст нь аль хэдийн бичигдсэн ХУУЧИН тайланд л талбар харагдана — эс
 *    бөгөөс хэвлэгдэж буй бичвэрийг засварлагч дээр засах/арилгах аргагүй
 *    болно.  Шинэ тайланд эдгээр хэзээ ч гарахгүй.
 *
 * ⚠️ Хэсэг нь баг сонгоогүй үед ч ҮРГЭЛЖ харагдана.  Урьд нь «Ажлын тайлан»
 *    зөвхөн баг сонгосны дараа гарч ирдэг байсан тул багаа сонгоогүй хүн
 *    (жишээ нь админ) тайлангаа бичих газаргүй байв.
 */
export function AsrWorkReportSection({
  entry,
  form,
  onChange,
  readOnly,
  selectedTeams,
  teamLabel,
  teamStrip,
}: {
  entry: AsrReport;
  form: AsrFormState;
  onChange: AsrChange;
  readOnly: boolean;
  selectedTeams: AsrTeamOption[];
  teamLabel: (o: AsrTeamOption) => string;
  /** Багийн чагтны мөр — маягтын «Хяналтаар явсан»-тай ИЖИЛ сонголт. */
  teamStrip?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const resolvedIn = entry.resolved_in ?? [];

  // Хуучин тайлангийн бичвэр — серверт хадгалагдсан ЭСВЭЛ маягтад байгаа үед
  // л.  Маягт ганцаараа биш: арилгаж байх үед (autosave-ээс өмнө) талбар гэнэт
  // алга болохгүй.
  const legacyGeneral = !!form.work_report.trim() || !!(entry.work_report ?? '').trim();
  const legacyNoteTeams = selectedTeams.filter(
    (o) =>
      !!(form.work_notes[o.id] ?? '').trim() ||
      !!(entry.teams ?? []).find((x) => x.team_id === o.id)?.work_note?.trim(),
  );

  return (
    <DocBlock id="asr-sec-work">
      <DocBand mn="Ажлын тайлан" en="Work report" />
      {teamStrip && <div className="border-b border-foreground/35 bg-muted/50">{teamStrip}</div>}

      {/* Хуучин тайлангийн ерөнхий бичвэр — шинэ тайланд гарахгүй (дээрх ⚠️). */}
      {legacyGeneral && (
        <DocText
          rows={3}
          placeholder={t('asr.workReportPlaceholder')}
          value={form.work_report}
          readOnly={readOnly}
          onChange={(e) => onChange({ work_report: e.target.value })}
        />
      )}

      {/* Хуучин тайлангийн багийн тэмдэглэл (0133) — тексттэй багийнх л. */}
      {legacyNoteTeams.map((o) => (
        <div key={o.id} className="flex gap-2 pl-3 pt-1">
          <span
            title={teamLabel(o)}
            className="mt-2.5 h-fit shrink-0 bg-brand-navy px-1.5 py-0.5 text-label font-bold text-white"
          >
            {templateTeamLabel(o.code)}
          </span>
          <div className="min-w-0 flex-1">
            <DocText
              rows={2}
              placeholder={t('asr.workNotePlaceholder', { team: o.code })}
              value={form.work_notes[o.id] ?? ''}
              readOnly={readOnly}
              className="px-1.5"
              onChange={(e) =>
                onChange((prev) => ({
                  work_notes: { ...prev.work_notes, [o.id]: e.target.value },
                }))
              }
            />
          </div>
        </div>
      ))}

      {/* 1. Үүрэг даалгавар */}
      <DocHead mn={t('asr.siteTasks')} en="Site instructions" />
      <DocText
        rows={2}
        placeholder={t('asr.siteTasksPlaceholder')}
        value={form.site_tasks}
        readOnly={readOnly}
        onChange={(e) => onChange({ site_tasks: e.target.value })}
      />

      {/* 2. Алдаа дутагдал */}
      <DocHead mn={t('asr.defects')} en="Defects found" />
      <DocText
        rows={2}
        placeholder={t('asr.defectsPlaceholder')}
        value={form.defects}
        readOnly={readOnly}
        onChange={(e) => onChange({ defects: e.target.value })}
      />
      {/* Энэ тайлангийн асуудлыг ДАРААГИЙН тайлан шийдсэн бол — уншихад л.
          Өмнөх (энэ) тайлангийн мөр хөндөгдөөгүй; сервер `loadResolvedIn`
          гарган авсан холбоос. */}
      {resolvedIn.length > 0 && (
        <ul className="mx-3 mb-2 space-y-1.5 rounded-md border border-success/30 bg-success/5 p-2 text-xs">
          {resolvedIn.map((r, i) => (
            <li key={`${r.report_id}-${i}`} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <div className="min-w-0 break-words">
                <span className="font-medium">
                  {t('asr.resolvedInReport', {
                    docNo: r.doc_no ?? '—',
                    date: tableDate(r.report_date),
                  })}
                </span>
                {r.resolution_text && (
                  <span className="text-muted-foreground"> — {r.resolution_text}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 3. Өмнөх тайлангийн асуудлын шийдэл */}
      <DocHead mn={t('asr.resolutions')} en="Resolution of previous report issues" />
      <div className="px-3 pb-3 pt-1.5">
        <AsrResolutionsEditor
          projectId={entry.project_id}
          currentId={entry.id}
          rows={form.resolutions}
          readOnly={readOnly}
          onChange={(rows) => onChange({ resolutions: rows })}
        />
        {readOnly && form.resolutions.length === 0 && (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>
    </DocBlock>
  );
}

/* ------------------------------------------------------------------ */
/*  Өмнөх тайлангийн асуудлын шийдэл                                   */
/* ------------------------------------------------------------------ */

/** Сонголтын мөрийн шошго: «ASR-003 · 2026.09.10 · Б.Бат». */
function sourceLabel(s: Pick<AsrIssueSource, 'doc_no' | 'report_date' | 'author_name'>) {
  return [s.doc_no ?? '—', tableDate(s.report_date), s.author_name].filter(Boolean).join(' · ');
}

/**
 * «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» — мөр бүр: өмнөх тайлан
 * (сонголт) + асуудлын цооног (өмнөх тайлангийн «Алдаа дутагдал»-аас
 * урьдчилан бөглөгдөнө, засаж болно) + шийдлийн бичвэр.
 *
 * Өмнөх тайлангийн жагсаалт зөвхөн «Өмнөх тайлан холбох» дарахад татагдана
 * (`enabled`) — засварлагч нээх бүрт нэмэлт дуудлага гарахгүй.  Хадгалаагүй
 * шинэ тайлан (`currentId === 0`) дээр ч ажиллана: жагсаалт төслөөр татагдана.
 */
function AsrResolutionsEditor({
  projectId,
  currentId,
  rows,
  readOnly,
  onChange,
}: {
  projectId: number;
  currentId: number;
  rows: AsrResolution[];
  readOnly: boolean;
  onChange: (rows: AsrResolution[]) => void;
}) {
  const { t } = useLanguage();
  const [picking, setPicking] = useState(false);
  const issues = useAsrPreviousIssues(projectId, picking && !readOnly);
  const sources = (issues.data?.reports ?? []).filter((r) => r.id !== currentId);

  const update = (i: number, patch: Partial<AsrResolution>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  const addFrom = (src: AsrIssueSource) => {
    onChange([
      ...rows,
      {
        prev_report_id: src.id,
        prev_doc_no: src.doc_no,
        prev_report_date: src.report_date,
        prev_status: src.status,
        prev_defects: src.defects,
        // Цооног: өмнөх тайлангийн «Алдаа дутагдал», байхгүй бол «Тайлбар».
        issue_text: (src.defects ?? src.description ?? '').trim(),
        resolution_text: '',
      },
    ]);
    setPicking(false);
  };

  const addFree = () => {
    onChange([...rows, { prev_report_id: null, issue_text: '', resolution_text: '' }]);
    setPicking(false);
  };

  if (readOnly && rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {!readOnly && <p className="text-xs text-muted-foreground">{t('asr.resolutionsHint')}</p>}

      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.id ?? `new-${i}`} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words text-xs font-medium">
                  {r.prev_report_id != null
                    ? t('asr.resolutionOf', {
                        docNo: r.prev_doc_no ?? `#${r.prev_report_id}`,
                        date: tableDate(r.prev_report_date),
                      })
                    : r.prev_doc_no
                      ? // Өмнөх тайлан устсан — цооногийн дугаар үлдэнэ.
                        t('asr.resolutionOf', {
                          docNo: r.prev_doc_no,
                          date: tableDate(r.prev_report_date),
                        })
                      : t('asr.resolutionNoLink')}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={t('common.delete')}
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground">{t('asr.resolutionIssue')}</div>
                <PolishableTextarea
                  rows={2}
                  placeholder={t('asr.resolutionIssuePlaceholder')}
                  value={r.issue_text}
                  disabled={readOnly}
                  aiPolish={false}
                  onChange={(e) => update(i, { issue_text: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground">{t('asr.resolutionText')}</div>
                <PolishableTextarea
                  rows={3}
                  placeholder={t('asr.resolutionTextPlaceholder')}
                  value={r.resolution_text}
                  disabled={readOnly}
                  aiPolish={!readOnly}
                  onChange={(e) => update(i, { resolution_text: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly && !picking && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setPicking(true)}
        >
          <Plus className="h-3.5 w-3.5" /> {t('asr.resolutionAdd')}
        </Button>
      )}

      {!readOnly && picking && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">{t('asr.resolutionPick')}</div>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="text-xs text-muted-foreground underline"
            >
              {t('common.cancel')}
            </button>
          </div>
          {issues.isLoading ? (
            <div className="text-xs text-muted-foreground">{t('common.loading')}</div>
          ) : sources.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t('asr.resolutionNoSources')}</div>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {sources.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => addFrom(s)}
                    className="w-full rounded-md border bg-background px-2.5 py-2 text-left text-xs hover:border-primary/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-medium">{sourceLabel(s)}</span>
                      {s.resolved_count > 0 && (
                        <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                          {t('asr.resolutionAlreadyResolved', { n: s.resolved_count })}
                        </span>
                      )}
                    </div>
                    {(s.defects || s.description) && (
                      <div className="mt-1 line-clamp-2 break-words text-muted-foreground">
                        {s.defects || s.description}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={addFree}
            className="text-xs text-muted-foreground underline"
          >
            {t('asr.resolutionAddFree')}
          </button>
        </div>
      )}
    </div>
  );
}
