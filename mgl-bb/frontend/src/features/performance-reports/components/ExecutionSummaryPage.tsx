import type {
  StatusMeeting,
  WorkforceRow,
} from '@/features/performance-reports/types/performanceReport';
import { PageHeader, PageFooter } from '@/features/performance-reports/components/TableOfContents';
import { EditableText } from '@/features/performance-reports/components/EditableText';
import { T } from '@/features/performance-reports/lib/reportText';

/* =============================================================
 * "Төслийг гүйцэтгэх хураангуй мэдээлэл" блок — нэг A4 хуудсан
 * дотор төслийн түлхүүр мэдээлэл (карт) + «Тайлангийн талбарууд»-ын
 * агуулга (Хураангуй / Ажиллах хүчин / Уулзалтын хуваарь)-ыг
 * нэгтгэн харуулна.
 *
 * ---------------------------------------------------------------
 * ⚠️ «ТАЙЛАНГИЙН ТАЛБАРУУД» — ХОЁР ТАЛТ ХОЛБОЛТ
 * ---------------------------------------------------------------
 * `summary_text`, `workforce`, `status_meetings` нь редакторын зүүн
 * талын форм дээр бөглөгддөг ч урьд нь урьдчилан харах хэсэгт ХААНА Ч
 * гарч ирдэггүй байсан («default texts … sometimes not visible»).
 * Одоо тэдгээр нь энэ хуудсан дээр гарахаас гадна ШУУД засварлагдана:
 * бичих бүрт `onReportChange` дуудагдаж редакторын локал төлөв,
 * улмаар зүүн талын input мөн адил шинэчлэгдэнэ.
 *
 * `onReportChange` өгөөгүй үед (хэвлэх зам, issued тайлан) талбарууд
 * зөвхөн УНШИГДАНА, хоосон хэсгүүд нь бүрмөсөн НУУГДАНА — цаасан дээр
 * хоосон гарчиг үлдээхгүй.  Засварлах горимд эсрэгээрээ: хоосон ч
 * гэсэн placeholder-той мөр гарч, хэрэглэгч хаана бичихээ мэднэ.
 *
 * ⚠️ Дуудагч (`PdfBlockRenderer`-ийн `execution-summary` салаа) нь
 * `summaryText` / `workforce` / `onReportChange`-ыг `ctx`-ээс дамжуулах
 * ЁСТОЙ; өгөөгүй бол зан төлөв нь өмнөх шигээ (зөвхөн карт).
 * ============================================================= */

/** `onReportChange`-д илгээх patch.  `PdfBlockRenderer.ReportFieldPatch`-ийн
 *  дэд олонлог — тэр модулиас import хийвэл дугуй хамаарал үүсэх тул
 *  бүтцээр нь давхардуулав (assignment хоёр тийш ажиллана). */
export interface ExecReportPatch {
  summary_text?: string | null;
  status_meetings?: StatusMeeting[];
  workforce?: WorkforceRow[];
}

/** «1. Төслийн танилцуулга»-ын resolve хийгдсэн (авто ⊕ override) утгууд
 *  дотроос ЭНЭ хуудсанд давхардаж хэвлэгддэг талбарууд.
 *  ⚠️ `IntroModel` нь үүнийг бүтцээрээ хангадаг тул дуудагч түүнийг
 *  ШУУД дамжуулж болно (импортын дугуй хамаарал үүсгэхгүйн тулд энд
 *  дахин зарлав — `ExecReportPatch`-ийн хэв маягтай ижил). */
export interface ExecIntroFacts {
  projectTitle: string;
  clientName: string;
  drawingNo: string;
  location: string;
  director: string;
  ceo: string;
}

export interface ExecutionSummaryPageProps {
  reportNo: number;
  reportDocNo: string | null;
  reportDate: string;
  /** Overall project progress (dashboard headline) — drives which
   *  milestones read as reached. */
  overallProgress: number;
  /** ⚠️ ЗААВАЛ.  §1-ийн `resolveIntroModel(override, auto)` гаралт.
   *
   *  Энэ хуудас урьд нь паспортыг ШУУД уншдаг байсан тул §1 дээр гараар
   *  засварласан гарчиг / шифр / захирал ЭНД ТУСДАГГҮЙ байв: нэг ижил
   *  тайлангийн хоёр хуудас ӨӨР нэр хэвлэдэг.
   *
   *  ⚠️ 2026-09-03: талбар нь `intro?` (сонголттой) байсан ба цорын ганц
   *  дуудагч (`PdfBlockRenderer`) түүнийг ХЭЗЭЭ Ч дамжуулдаггүй байсан тул
   *  «засвар» нь бүхэлдээ үхмэл код байв.  Одоо ЗААВАЛ болгосон —
   *  дамжуулаагүй дуудагч компайл болохгүй, тиймээс дахин чимээгүй
   *  салах боломжгүй.  Нөхөлтийн шатлал ЭНД БАЙХГҮЙ: `passport` /
   *  `clients` / `projectName` prop-уудыг ЗОРИУД устгасан — эх сурвалж
   *  нь зөвхөн §1-ийн resolve хийгдсэн загвар. */
  intro: ExecIntroFacts;
  meetings: StatusMeeting[];
  /** «Тайлангийн талбарууд» → `report.summary_text`. */
  summaryText?: string | null;
  /** «Тайлангийн талбарууд» → `report.workforce`. */
  workforce?: WorkforceRow[];
  /** Өгвөл дээрх талбарууд хуудсан дээрээс ШУУД засварлагдана. */
  onReportChange?: (patch: ExecReportPatch) => void;
}

interface Milestone {
  label: string;
  sub: string;
  date: string | null;
  done: boolean;
}

export interface ProjectTimelineStepperProps {
  startDate: string | null;
  finishDate: string | null;
  extensionDate: string | null;
  meetings: StatusMeeting[];
  overallProgress: number;
}

/* Vertical timeline stepper: Start → scheduled meetings (by %) →
 * Extension (if any) → Finish. A step reads as done when it has a
 * completed_at or the overall progress reached its %. Reused on both
 * the execution-summary page and the "2.1" charts page. */
export function ProjectTimelineStepper(p: ProjectTimelineStepperProps) {
  const meetingSteps: Milestone[] = [...p.meetings]
    .sort(
      (a, b) => a.percent - b.percent || (a.scheduled_at || '').localeCompare(b.scheduled_at || ''),
    )
    .map((m) => ({
      label: `${m.percent}% уулзалт`,
      sub: `${m.percent}% meeting`,
      date: m.scheduled_at || null,
      done: !!m.completed_at || p.overallProgress >= m.percent,
    }));

  const steps: Milestone[] = [
    { label: 'Эхлэл', sub: 'Start', date: p.startDate, done: true },
    ...meetingSteps,
    ...(p.extensionDate
      ? [{ label: 'Сунгалт', sub: 'Extension', date: p.extensionDate, done: false }]
      : []),
    { label: 'Дуусах', sub: 'Finish', date: p.finishDate, done: p.overallProgress >= 100 },
  ];

  return (
    <>
      <div className="perf-intro__sub" data-a4-item>
        <T k="exec.h.timeline">Төслийн хугацаа</T>{' '}
        <T as="em" k="exec.h.timeline.en">
          (Project timeline)
        </T>
      </div>
      <ol className="perf-stepper">
        {steps.map((s, i) => (
          /* Алхам бүр бие даасан нэгж — `<ol>` дээр тэмдэглэвэл уулзалт
             олон болоход бүх stepper нэг дор дараагийн хуудас руу үсэрнэ. */
          <li key={i} data-a4-item className={`perf-stepper__item${s.done ? ' is-done' : ''}`}>
            <span className="perf-stepper__dot" />
            <div className="perf-stepper__body">
              <div className="perf-stepper__label">
                {s.label} <em>{s.sub}</em>
              </div>
              <div className="perf-stepper__date">{s.date ?? '—'}</div>
            </div>
            <span className="perf-stepper__mark">{s.done ? '✓' : '○'}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function ExecutionSummaryPage(p: ExecutionSummaryPageProps) {
  /* ---------- Төслийн хувийн мэдээлэл — НЭГ эх сурвалж ----------
   * ⚠️ `p.passport.<багана> ?? '—'` гэж ЭНД БИТГИЙ БИЧ, `resolveProjectIdentity`-г
   * ч ЭНД БИТГИЙ ДУУД.  §1 нь тэр шатлал дээр хэрэглэгчийн override-ыг
   * давхарлаж хэвлэдэг тул энд өөр гинж ургавал НЭГ тайлангийн хоёр хуудас
   * ӨӨР нэр хэвлэнэ.  Дуудагч (`PdfBlockRenderer`) §1-тэй ЯГ ИЖИЛ
   * `resolveIntroModel(override, introAuto)` дуудлагын гаралтыг өгнө. */
  const facts = p.intro;
  const dash = (v: string): string => (v.trim() ? v : '—');

  const patch = p.onReportChange;
  const editable = !!patch;

  /* Хоосон үед: засварлах горимд НЭГ хоосон мөр (placeholder-той) гаргаж
   * хаана бичихийг харуулна; хэвлэх/issued үед хэсгийг бүрмөсөн нууна. */
  const wfSrc = p.workforce ?? [];
  const wfRows: WorkforceRow[] =
    wfSrc.length > 0 ? wfSrc : editable ? [{ category: '', count: 0, description: '' }] : [];

  const mtSrc = p.meetings ?? [];
  const mtRows: StatusMeeting[] =
    mtSrc.length > 0 ? mtSrc : editable ? [{ label: '', percent: 0, scheduled_at: '' }] : [];

  const summaryVisible = editable || !!(p.summaryText && p.summaryText.trim());

  const onlyDigits = (raw: string) => Number(raw.replace(/[^0-9.]/g, '')) || 0;

  const setWf = (i: number, field: 'category' | 'count' | 'description', raw: string) => {
    if (!patch) return;
    const next = wfRows.map((r) => ({ ...r }));
    const row = next[i];
    if (!row) return;
    if (field === 'count') row.count = Math.round(onlyDigits(raw));
    else if (field === 'category') row.category = raw;
    else row.description = raw;
    patch({ workforce: next });
  };

  const setMt = (i: number, field: 'label' | 'percent' | 'scheduled_at', raw: string) => {
    if (!patch) return;
    const next = mtRows.map((r) => ({ ...r }));
    const row = next[i];
    if (!row) return;
    if (field === 'percent') row.percent = Math.round(onlyDigits(raw));
    else if (field === 'label') row.label = raw;
    else row.scheduled_at = raw;
    patch({ status_meetings: next });
  };

  return (
    <div className="perf-page">
      <PageHeader reportNo={p.reportNo} reportDocNo={p.reportDocNo} reportDate={p.reportDate} />

      <div className="perf-intro__section-num" data-a4-item>
        <T k="exec.h.section">Төслийг гүйцэтгэх хураангуй мэдээлэл</T>
        <T as="em" k="exec.h.section.en">
          Project execution summary
        </T>
      </div>

      {/* ---- Summary facts ---- */}
      <table className="perf-table perf-table--passport perf-exec__facts" data-a4-item>
        <tbody>
          <tr>
            <th>
              <T k="exec.lbl.title">Төслийн нэр:</T>
              <T as="small" k="exec.lbl.title.en">
                (Project title)
              </T>
            </th>
            <td colSpan={3}>{facts.projectTitle}</td>
          </tr>
          <tr>
            <th>
              <T k="exec.lbl.client">Захиалагч:</T>
              <T as="small" k="exec.lbl.client.en">
                (Client)
              </T>
            </th>
            <td>{dash(facts.clientName)}</td>
            <th>
              <T k="exec.lbl.drawingno">Зургийн шифр:</T>
              <T as="small" k="exec.lbl.drawingno.en">
                (Drawing No.)
              </T>
            </th>
            <td>{dash(facts.drawingNo)}</td>
          </tr>
          <tr>
            <th>
              <T k="exec.lbl.location">Байршил:</T>
              <T as="small" k="exec.lbl.location.en">
                (Location)
              </T>
            </th>
            <td>{dash(facts.location)}</td>
            <th>
              <T k="exec.lbl.progress">Нийт явц:</T>
              <T as="small" k="exec.lbl.progress.en">
                (Overall progress)
              </T>
            </th>
            <td>
              <strong>{p.overallProgress.toFixed(1)}%</strong>
            </td>
          </tr>
          <tr>
            <th>
              <T k="exec.lbl.director">Захирал:</T>
              <T as="small" k="exec.lbl.director.en">
                (Director)
              </T>
            </th>
            <td>{dash(facts.director)}</td>
            <th>
              <T k="exec.lbl.ceo">Гүйцэтгэх захирал:</T>
              <T as="small" k="exec.lbl.ceo.en">
                (CEO)
              </T>
            </th>
            <td>{dash(facts.ceo)}</td>
          </tr>
        </tbody>
      </table>

      {/* ---- Танилцуулга / Хураангуй  (report.summary_text) ---- */}
      {summaryVisible && (
        <div className="perf-exec__field" data-a4-item>
          <div className="perf-intro__sub">
            <T k="exec.h.summary">Танилцуулга</T>{' '}
            <T as="em" k="exec.h.summary.en">
              (Summary)
            </T>
          </div>
          <p className="perf-exec__summary">
            <EditableText
              as="span"
              multiline
              fieldKey="exec.field.summary_text"
              value={p.summaryText ?? ''}
              onChange={patch ? (next) => patch({ summary_text: next }) : undefined}
              disabled={!editable}
              placeholder="Тайлангийн товч танилцуулга — энэ тайлант хугацаанд юу хийгдсэн бэ?"
            />
          </p>
        </div>
      )}

      {/* ---- Ажиллах хүчин  (report.workforce) ---- */}
      {wfRows.length > 0 && (
        <div className="perf-exec__field" data-a4-item>
          <div className="perf-intro__sub">
            <T k="exec.h.workforce">Ажиллах хүчин</T>{' '}
            <T as="em" k="exec.h.workforce.en">
              (Workforce)
            </T>
          </div>
          <table className="perf-table perf-exec__wf">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>
                  <T k="exec.col.wf.category">Ангилал</T>
                </th>
                <th style={{ width: '14%' }}>
                  <T k="exec.col.wf.count">Тоо</T>
                </th>
                <th>
                  <T k="exec.col.wf.desc">Тайлбар</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {wfRows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <EditableText
                      fieldKey={`exec.field.wf.${i}.category`}
                      value={r.category ?? ''}
                      onChange={patch ? (next) => setWf(i, 'category', next) : undefined}
                      disabled={!editable}
                      placeholder="Инженер"
                    />
                  </td>
                  <td>
                    <EditableText
                      fieldKey={`exec.field.wf.${i}.count`}
                      value={String(r.count ?? 0)}
                      onChange={patch ? (next) => setWf(i, 'count', next) : undefined}
                      disabled={!editable}
                      placeholder="0"
                    />
                  </td>
                  <td>
                    <EditableText
                      fieldKey={`exec.field.wf.${i}.description`}
                      value={r.description ?? ''}
                      onChange={patch ? (next) => setWf(i, 'description', next) : undefined}
                      disabled={!editable}
                      placeholder="Тайлбар"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Уулзалтын хуваарь  (report.status_meetings) ---- */}
      {mtRows.length > 0 && (
        <div className="perf-exec__field" data-a4-item>
          <div className="perf-intro__sub">
            <T k="exec.h.meetings">Уулзалтын хуваарь</T>{' '}
            <T as="em" k="exec.h.meetings.en">
              (Meeting schedule)
            </T>
          </div>
          <table className="perf-table perf-exec__mt">
            <thead>
              <tr>
                <th style={{ width: '46%' }}>
                  <T k="exec.col.mt.label">Уулзалт</T>
                </th>
                <th style={{ width: '16%' }}>
                  <T k="exec.col.mt.percent">Явц %</T>
                </th>
                <th>
                  <T k="exec.col.mt.date">Огноо</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {mtRows.map((m, i) => (
                <tr key={i}>
                  <td>
                    <EditableText
                      fieldKey={`exec.field.mt.${i}.label`}
                      value={m.label ?? ''}
                      onChange={patch ? (next) => setMt(i, 'label', next) : undefined}
                      disabled={!editable}
                      placeholder="Эхний хяналтын уулзалт"
                    />
                  </td>
                  <td>
                    <EditableText
                      fieldKey={`exec.field.mt.${i}.percent`}
                      value={String(m.percent ?? 0)}
                      onChange={patch ? (next) => setMt(i, 'percent', next) : undefined}
                      disabled={!editable}
                      placeholder="30"
                    />
                  </td>
                  <td>
                    <EditableText
                      fieldKey={`exec.field.mt.${i}.date`}
                      value={m.scheduled_at ?? ''}
                      onChange={patch ? (next) => setMt(i, 'scheduled_at', next) : undefined}
                      disabled={!editable}
                      placeholder="2026-01-31"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PageFooter />
    </div>
  );
}

export const EXECUTION_SUMMARY_STYLES = `
.perf-exec__facts { margin-bottom: 10mm; }

/* «Тайлангийн талбарууд» — Хураангуй / Ажиллах хүчин / Уулзалтын хуваарь. */
.perf-exec__field { margin-bottom: 8mm; }
.perf-exec__summary {
  font-size: 10.5pt;
  line-height: 1.6;
  text-align: justify;
  margin: 2mm 0 0;
  white-space: pre-wrap;
}
.perf-exec__wf td, .perf-exec__mt td { font-size: 10pt; }

.perf-stepper {
  list-style: none;
  margin: 4mm 0 0;
  padding: 0 0 0 6mm;
}
.perf-stepper__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6mm;
  padding: 3.5mm 0;
}
/* connecting vertical line between dots */
.perf-stepper__item::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 50%;
  bottom: -3.5mm;
  width: 2px;
  background: #c7cfd9;
}
.perf-stepper__item:last-child::before { display: none; }
.perf-stepper__dot {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #c7cfd9;
}
.perf-stepper__item.is-done .perf-stepper__dot {
  background: #0F243E;
  border-color: #0F243E;
}
.perf-stepper__body { flex: 1 1 auto; }
.perf-stepper__label { font-size: 11pt; font-weight: 700; color: #0F243E; }
.perf-stepper__label em { font-weight: 400; font-style: italic; font-size: 9pt; color: #6b7785; }
.perf-stepper__date {
  font-family: "Helvetica", "Arial", sans-serif;
  font-size: 9.5pt;
  color: #444;
  margin-top: 1px;
}
.perf-stepper__mark {
  flex: 0 0 auto;
  font-size: 12pt;
  font-weight: 700;
  color: #9aa6b3;
}
.perf-stepper__item.is-done .perf-stepper__mark { color: #0F243E; }
`;
