import type { ReactNode } from 'react';
import { mediaUrl } from '@/shared/api/client';
import { HandSignature } from '@/shared/components/HandSignature';
import { formatDate } from '@/shared/lib/time';
import {
  ASR_DOC_TITLE_EN,
  DOC_KIND_ROWS,
  GRID_COLS,
  GRID_TOTAL,
  TEMPLATE_TEAM_CODES,
  VISITED_TEAM_CELLS,
  WORK_REPORT_TEAMS,
  asrHeaderDocNo,
  headerDate,
  tableDate,
  templateTeamLabel,
} from './asrTemplate';
import { asrProjectLabel, asrProjectName } from './asrProjectName';
import {
  MEETING_LABEL,
  meetingFooter,
  meetingPartiesText,
  meetingRequestSections,
  type PrintedRequestSection,
} from './meetingDoc';
import { photoStamp } from './photoStamp';
import { asrInfoRows, pairInfoRows } from './projectInfo';
import {
  ASR_REPORT_TYPES,
  REPORT_TYPE_LABEL_MN,
  chunkPhotos,
  meetingTimeRange,
  redBookStatusOf,
  reportTypeOf,
  usesMeetingForm,
  type AsrDocKind,
  type AsrProjectInfo,
  type AsrReport,
} from './types';

/**
 * Улаан дэвтрийн төлөвийн шошго — баримт дээр ХАТУУ монголоор (энэ файлын
 * толгойн дүрэм).  UI-ийн `asr.redBook*` i18n түлхүүрүүдтэй утга нь ижил.
 */
const RED_BOOK_LABEL = {
  missing: 'Гарын үсэг дутуу',
  absent: 'Талбай дээр улаан дэвтэр байгаагүй',
  signed: 'Гарын үсэг зурагдсан (баталгаажуулалт хүлээж байна)',
  verified: 'Улаан дэвтэр баталгаажсан',
} as const;

/**
 * Зохиогчийн хяналтын тайлан — хэвлэх / PDF баримт.
 *
 * ⚠️ 2026-09-23-аас ЭЗНИЙ ӨГСӨН ЖИШЭЭ БАРИМТЫН («01. Жишээ тайлан.pdf»,
 *    MEC-25/07 ЛЮКСВҮҮД УУРХАЙЧИН-3) хэлбэр.  Өмнөх Гүйцэтгэлийн тайлангийн
 *    хэв маяг (дугаарласан «1. / 2. / 3.» хэсгийн гарчиг, хэсэг бүрийн
 *    тусдаа хүснэгт) ХАСАГДСАН — жишээ нь ЦААСАН МАЯГТ: энгийн саарал
 *    толгойн мөр, хар хүрээтэй блокууд, хар-хөх шошгын нүд, дотор нь
 *    налуу бичвэр.
 *
 *    Эзний ГУРВАН шийдвэр (2026-09-23, тэр өдрийн яриа):
 *    1) Жишээний ХОЁРДУГААР блок — «Зохиогчийн хяналтыг … гүйцэтгэлээ» +
 *       «Хяналт гүйцэтгэх үеийн ажлын явц:» + Attachment — БҮХЭЛДЭЭ
 *       хасагдана.  Бидний `work_report` талбарын бичвэр түүнд таарч
 *       байсан тул тэр нь одоо «АЖЛЫН ТАЙЛАН» блокийн ДОТОР, багийн
 *       чагтны дараа эхний догол мөр болж орно (өгөгдөл алдагдахгүй).
 *    2) Жишээний СҮҮЛИЙН хуудас («Хавсралт» — ерөнхий зангилааны зураг,
 *       арматурын схем) тайланд ОРОХГҮЙ.  Тэр нь тухайн төслийн гараар
 *       нэмсэн хуудас, системийн үүсгэх хэсэг БИШ.
 *    3) Зургийн хуудас = ЯГ 4 зураг (2×2), зураг бүр дугаар + тайлбартай
 *       (0336-ийн боломж) — ХЭВЭЭР ҮЛДЭНЭ.
 *
 *    Жишээнд БАЙХГҮЙ, гэхдээ эзэн ҮЛДЭЭХЭЭР сонгосон дөрвөн зүйл
 *    (2026-09-23): «Улаан дэвтэр», «Өмнөх тайлангийн шийдэл», «Төслийн
 *    мэдээлэл» (Захиалагч / Байршил / Гэрээний хугацаа …) ба толгой дахь
 *    тайлангийн № (DASR-001).  Төслийн мэдээлэл нь ТУСДАА хүснэгт БИШ,
 *    маягтын нэг хүснэгтийн мөрүүд болж нийлсэн — жишээний хэлбэр нь нэг
 *    блок (`pairInfoRows`: богино утга хосоороо, урт нь бүтэн өргөнөөр).
 *
 * ⚠️ Checkbox нь ЮНИКОД ГЛИФ БИШ, CSS-ээр зурсан хайрцаг (`.asr-cb`).
 *    Cloudflare Browser Rendering-ийн Chromium-д ☐/☒ глиф fallback-д орж
 *    өөр фонтоор, өөр хэмжээгээр зурагддаг байсан (прод PDF дээр хэмжсэн
 *    2026-09-16) — CSS хайрцаг нь фонтоос хамаарахгүй.
 *
 * ⚠️ Өнгө нь ШУУД hex (`asrPrintStyles.ts`) — Tailwind-ийн токен БИШ.  Энэ
 *    баримт нь `useForceLightTheme`-тэй хуудсан дээр ч `.dark` root дотор
 *    сууж, `index.css` зөвхөн `html/body`-г цайруулдаг тул токен хэрэглэвэл
 *    цагаан цаасан дээр цагаан үсэг гарна.
 *
 * ⚠️ Текст нь ЗОРИУДААР монголоор hardcode: энэ бол цаасан баримт, хэлээр
 *    хувирдаг UI биш (`TeamReportsTab`-ийн адил зарчим).
 *
 * ХУУДАСНЫ БҮТЭЦ (`asrPrintStyles.ts`-ийн толгойг үз): гадна `.asr-page`
 * хүснэгтийн <thead> = running толгой (Chrome хуудас бүрт давтана), tbody-ийн
 * ганц нүд = блокууд, <tfoot> = хуудас бүрийн доод зай.  Хуудасны ХӨЛ
 * БАЙХГҮЙ (эзэн 2026-09-28: хуудасны дугаар ч, браузерын огноо/URL ч үгүй) —
 * `@page` зай 0, жинхэнэ зай нь thead/tfoot + хажуугийн padding.
 *
 * ⚠️ ТОЛГОЙ = Word загварын (`public/asr-template.docx` → `word/header1.xml`)
 *    толгой (эзний шийдвэр 2026-09-28): зүүн талд «Design Author’s
 *    Supervision Report» (тод) / «Report Date: 2026/09/25» / «Doc. No.:
 *    <төслийн ID>_DASR_<баг>_<NNN>», баруун талд MGL E&C лого, доор нь бүтэн
 *    өргөний зураас.  Бүх утга АВТОМАТ (тайлангийн огноо, шифр, эхний баг,
 *    дугаар) — `asrHeaderDocNo`, Word-той ижил функц.  ЛОГО нь ЗӨВХӨН толгойд
 *    (гарын үсгийн хажуугийнх хасагдсан — хоёр удаа хэвлэгдэхгүй).
 *    Маягтын хүснэгт хар-хөх хэвээр (эзэн лавлагааны цайвар хүснэгтийг
 *    СОНГООГҮЙ).
 */

/** CSS-ээр зурсан checkbox.  `on` бол хар-хөх дүүргэлт + цагаан хачиг. */
function Check({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={on ? 'asr-check asr-check--on' : 'asr-check'}>
      <span className="asr-cb" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** Хар-хөх шошгын нүд: монгол шошго + налуу англи дэд шошго. */
function Lbl({ mn, en, className }: { mn: string; en?: string; className?: string }) {
  return (
    <th className={className ? `asr-lbl ${className}` : 'asr-lbl'}>
      <span className="asr-lbl-mn">{mn}</span>
      {en && <span className="asr-lbl-en">({en})</span>}
    </th>
  );
}

/**
 * Маягтын хар-хөх шошгын нүд — Word загварын хэлбэр: 8pt тод цагаан, англи
 * дэд шошгогүй.  Бүх шошго зүүн талаасаа эхэлнэ (эзэн 2026-09-30) — Word
 * загварт голлуулсан байсан Шифр, Тайлбар, Хяналтаар явсан, Шалгасан ч гэсэн;
 * Word экспорт `buildAsrDocx.ts` `leftAlignLabelCells`-ээр ижил болгодог.
 */
function FLbl({
  children,
  colSpan,
  rowSpan,
}: {
  children: ReactNode;
  colSpan?: number;
  rowSpan?: number;
}) {
  return (
    <th colSpan={colSpan} rowSpan={rowSpan} className="asr-flbl">
      {children}
    </th>
  );
}

/**
 * «Хяналтаар гарсан шийдвэрлэх асуудлууд:» — ажлын тайлангийн БИЕ дотор
 * тод-налуу дэд гарчиг (жишээ баримтын хэлбэр).  Хар-хөх тууз БИШ: жишээнд
 * бүх дэд хэсэг нэг хүрээтэй хайрцаг дотор урсдаг.
 */
function WorkHead({ mn, en }: { mn: string; en: string }) {
  return (
    <div className="asr-wh">
      <span className="asr-wh-mn">{mn}:</span> <span className="asr-wh-en">{en}</span>
    </div>
  );
}

/**
 * Оффис уулзалтын хүсэлтийн хүснэгт (0396, эзний Word тэмдэглэлийн хэлбэр):
 * «0.1 Захиалагч» гарчиг → оршил → № · Хүсэлт гаргагч (нэгтгэсэн нүд) ·
 * Тайлбар → хар-хөх хөлийн мөр.  Word-ийн ихэр `buildAsrDocx.ts`
 * `meetingRequestXml`, засварлагчийнх `AsrMeetingRequests.tsx`.
 */
/**
 * Оффис уулзалтын ХӨЛ (эзний RFI/тэмдэглэлийн хэлбэр, 2026-10-12) — «Тал | Албан
 * тушаал | Гарын үсэг | Огноо» хүснэгтийн оронд:
 *
 *   MGL E&C LLC Талаас Хуралд оролцсон:
 *   «Эм Жи Эл И Эн Си» ХХК-ийн
 *   Архитектор Б.Эрдэнэжин ..............................
 *
 *   «Жинди Хуарун» ХХК Талаас төлөөлж гарын үсэг зурсан:
 *   «Жинди Хуарун» ХХК-ийн
 *   Төслийн менежер Ma Cheng Cheng ......................
 *
 *   2026.09.29
 *
 * Гарын үсгийн зураг (байвал) цэгтэй мөрийн дээр.  Word-ийн ихэр
 * `buildAsrDocx.ts` `meetingFooterXml`; агуулгын дүрэм `meetingDoc.ts` `meetingFooter`.
 */
function MeetingFooterBlock({ entry }: { entry: AsrReport }) {
  const f = meetingFooter(entry);
  const person = (p: { orgLine: string; nameLine: string; signatureUrl: string | null }, k: number) => (
    <div key={k} className="asr-mf-person">
      {p.orgLine && <div>{p.orgLine}</div>}
      <div className="asr-mf-line">
        <span>{p.nameLine}</span>
        <span className="asr-mf-dots">
          {p.signatureUrl && (
            <HandSignature src={mediaUrl(p.signatureUrl)} fitToInk="document" />
          )}
        </span>
      </div>
    </div>
  );
  return (
    <section className="asr-block asr-mf">
      <div className="asr-mf-head">{f.ourHead}</div>
      {f.our.map(person)}
      <div className="asr-mf-head asr-mf-head--client">{f.clientHead}</div>
      {f.client ? person(f.client, 0) : person({ orgLine: '', nameLine: '', signatureUrl: null }, 0)}
      <div className="asr-mf-date asr-num">{tableDate(entry.report_date)}</div>
    </section>
  );
}

/**
 * Мөр / «Тайлбар»-ын ард хавсаргасан зураг (эзэн 2026-10-12) — бичвэрийн доор,
 * нэг мөрөнд 2 хүртэл, хуудас хооронд таслагдахгүй.  Word-ийн ихэр
 * `buildAsrDocx.ts` (`meetingRequestXml` / `meetingNote`).
 */
function ItemImages({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="asr-item-imgs">
      {urls.map((u) => (
        <img key={u} src={mediaUrl(u)} alt="" />
      ))}
    </div>
  );
}

function MeetingRequestTable({ sec }: { sec: PrintedRequestSection }) {
  const hasImages = sec.items.some((it) => it.images.length > 0);
  return (
    <div className="asr-req">
      <div className="asr-req-head">{sec.heading}</div>
      {sec.intro && <div className="asr-req-intro asr-wrap">{sec.intro}</div>}
      <table className="asr-t asr-req-t">
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '74%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="asr-req-th">{MEETING_LABEL.requestNo}</th>
            <th className="asr-req-th">{MEETING_LABEL.requestBy}</th>
            <th className="asr-req-th">{MEETING_LABEL.requestText}</th>
          </tr>
        </thead>
        <tbody>
          {sec.items.length === 0 ? (
            <tr>
              <td className="asr-mid">—</td>
              <td className="asr-mid">{sec.sideLabel}</td>
              <td />
            </tr>
          ) : (
            sec.items.map((item, i) => (
              <tr key={i}>
                <td className="asr-mid asr-num">{i + 1}</td>
                {/* «Хүсэлт гаргагч» нэгтгэсэн нүд.  Зурагтай хүснэгтэд rowspan нь
                    апп доторх A4 харагдацад (multicol) хүснэгтийг хуудас хооронд
                    хуваагдуулдаггүй — бүхэлд нь дараагийн хуудас руу түлхэж том
                    хоосон зай үлдээдэг (хэмжсэн).  Тиймээс тэр үед нүд бүр тусдаа,
                    дотор хүрээгүй (харагдахдаа нэгтгэсэн), шошго эхний мөрөнд. */}
                {!hasImages ? (
                  i === 0 && (
                    <td className="asr-mid" rowSpan={sec.items.length}>
                      {sec.sideLabel}
                    </td>
                  )
                ) : (
                  <td
                    className={`asr-mid asr-req-by${i < sec.items.length - 1 ? ' asr-req-by--open' : ''}`}
                  >
                    {i === 0 ? sec.sideLabel : ''}
                  </td>
                )}
                <td className="asr-wrap">
                  {item.text}
                  <ItemImages urls={item.images} />
                </td>
              </tr>
            ))
          )}
          {/* Хөлийн хар-хөх мөр — жишээ баримтын хэлбэр. */}
          <tr className="asr-req-foot" aria-hidden>
            <td />
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Хуудас бүрийн running толгой — Word загварын header1.xml (файлын толгойн
 * тайлбарыг үз).  Хэвлэхэд гадна хүснэгтийн <thead> дотор (Chrome хуудас
 * бүрт давтана), дэлгэцийн A4 хуудаслалтад (`AsrPagedDocument`) хуудасны
 * карт бүр дээр тусад нь — multicol нь thead-ийг давтдаггүй.
 *
 * @param projectName `projects.name` (дагаваргүй ч байж болно) — Doc. No.-ийн
 *   PROJECT-ID үүнээс.  ЗХ-д засварласан нэр (0358) энд БИШ: код алдагдана.
 */
export function AsrRunningHeader({
  entry,
  projectName,
}: {
  entry: AsrReport;
  projectName: string;
}) {
  return (
    <div className="asr-head">
      <div className="asr-head-text">
        <div className="asr-head-title">{ASR_DOC_TITLE_EN}</div>
        <div className="asr-head-line">
          Report Date: <span className="asr-num">{headerDate(entry.report_date)}</span>
        </div>
        <div className="asr-head-line">Doc. No.: {asrHeaderDocNo(entry, projectName)}</div>
      </div>
      <div className="asr-logo-box">
        <img className="asr-logo" src="/logo.svg" alt="MGL E&C" />
      </div>
    </div>
  );
}

export interface AsrDocumentProps {
  entry: AsrReport;
  /** `projects.name` — PROJECT-ID (Doc. No.) үүнээс. */
  projectName: string;
  /**
   * ЗХ-д засварласан нэр (`projects.asr_name`, 0358).  Өгвөл «Төслийн нэр»
   * нүд, зургийн хуудас, тэмдэг үүнийг харуулна; Doc. No. хөндөгдөхгүй.
   */
  projectLabel?: string | null;
  /**
   * ХҮЧИН ТӨГӨЛДӨР шифр.  Өгөөгүй бол `entry.shifr` — сервер тал түүнийг
   * аль хэдийн `override ?? паспорт` болгож нэгтгэсэн байдаг.  Хэвлэх хуудас
   * нь утгыг ИЛ дамжуулдаг: баримтын толгойд юу гарахыг дуудагч хуудас
   * шийдэж байгааг код уншихад ил байлгах зорилготой.
   */
  shifr?: string | null;
  /**
   * Хуучин — «Албан ёсны нэр» мөр 2026-09-28-нд хасагдсан тул уншигдахгүй;
   * дуудагчдын гэрээний нийцлийн үүднээс үлдээв.
   */
  officialTitle?: string | null;
  /**
   * Төслийн товч танилцуулга (эзний шийдвэр 2026-09-04, 2026-09-23-нд
   * ҮЛДЭЭХЭЭР батлагдсан).  Өгөөгүй бол `entry.project_info`.  Хоосон бол
   * маягтад мөр нэмэгдэхгүй.
   */
  projectInfo?: AsrProjectInfo | null;
  /**
   * Хуучин «нэг хуудсанд багтаах» тохиргоо — баримт ердийн урсгалаар
   * хуудаслагддаг тул нөлөөгүй; гэрээний нийцлийн үүднээс үлдээв.
   */
  fitToPage?: boolean;
}

export function AsrDocument({
  entry,
  projectName: rawProjectName,
  projectLabel,
  shifr: shifrProp,
  projectInfo,
}: AsrDocumentProps) {
  // ⚠️ `entry.shifr` нь ХҮЧИН ТӨГӨЛДӨР утга (`shapeRow`), түүхий override БИШ —
  //    тиймээс ноорог тайлан ч паспортын шифрээр хэвлэгдэнэ.
  const shifr = (shifrProp ?? entry.shifr) || '';
  // 0363 — тайлан бүрт бөглөнө; бөглөөгүй бол цаасан дээр хоосон нүд.
  const contractNo = (entry.contract_no ?? '').trim();
  // ЗХ-д ангиллын дагаваргүй нэр (`asrProjectName`) — «…_ZA» хэвлэгдэхгүй;
  // админ ЗХ-д нэрийг засварласан бол (0358) тэр.  Doc. No.-ийн код нь
  // засварласан нэрээс БИШ, `projects.name`-ээс (`codeName`).
  const codeName = asrProjectName(rawProjectName);
  const projectName = asrProjectLabel({ name: rawProjectName, asr_name: projectLabel });
  const teams = entry.teams ?? [];
  const picked = new Set(teams.map((t) => t.team_code));
  const kinds = new Set<AsrDocKind>(entry.doc_types ?? []);
  // Хяналтын төрөл (0362) — 4 чагтаас ЯГ НЭГ нь тэмдэглэгдэнэ.
  const reportType = reportTypeOf(entry);
  const platform = (entry.meeting_platform ?? '').trim();
  /**
   * Оффис уулзалтын баримт (0367, эзэн 2026-09-30): Тайлбар / Бичиг баримтын
   * төрлийн оронд уулзалтын мэдээлэл, «Хяналтаар явсан» → «Оролцсон» (нэрс),
   * «Ажлын тайлан» → «Уулзалтын агуулга» (ганц бичвэр), «Талбайн Инженер» →
   * «Захиалагч тал», улаан дэвтэргүй, хавсралт нь хуудсанд НЭГ том зураг.
   * Word-ийн ихэр `buildAsrDocx.ts`.
   */
  const meeting = usesMeetingForm(reportType);

  // Загварт байхгүй боловч сонгогдсон багууд — жагсаалтын хойно нэмэлт болно.
  const extras = teams.filter((t) => !TEMPLATE_TEAM_CODES.has(t.team_code)).map((t) => t.team_code);
  // Маягтын «Хяналтаар явсан» мөрөнд НҮДГҮЙ сонгосон багууд (АУ г.м.) —
  // `TEMPLATE_TEAM_CODES` нь АУ-г агуулдаг тул тусдаа олонлог хэрэгтэй.
  const visitedExtras = teams
    .map((t) => t.team_code)
    .filter((code) => !VISITED_TEAM_CELLS.some((c) => c.code === code));

  const withNotes = teams.filter((t) => (t.work_note ?? '').trim().length > 0);
  // 0336 — «Ажлын тайлан» дэд хэсгүүд + зургийн хуудаслалт (4 = 2×2).
  const workReport = (entry.work_report ?? '').trim();
  /** 0396 — оффис уулзалтын хүсэлтийн хүснэгтүүд (хоосон мөр алгасагдана). */
  const requestSections = meeting ? meetingRequestSections(entry.meeting_requests) : [];
  const siteTasks = (entry.site_tasks ?? '').trim();
  const defects = (entry.defects ?? '').trim();
  const resolutions = entry.resolutions ?? [];
  const resolvedIn = entry.resolved_in ?? [];
  const sheetSize = meeting ? 1 : 4;
  const photoSheets = chunkPhotos(entry.photos, sheetSize);

  // Хоосон утгатай мөрийг `asrInfoRows` өөрөө хаядаг.  «Албан ёсны нэр» ба
  // «Байршил» тэнд БАЙХГҮЙ (эзэн 2026-09-28).
  const infoRows = asrInfoRows(projectInfo ?? entry.project_info);
  const redBook = redBookStatusOf(entry);
  const description = [
    entry.description || '',
    kinds.has('other') && entry.doc_type_other ? `(${entry.doc_type_other})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const teamChecks = (
    <>
      {WORK_REPORT_TEAMS.map((c) => (
        <Check key={c.label} on={!!c.code && picked.has(c.code)}>
          {c.label}
        </Check>
      ))}
      {extras.map((code) => (
        <Check key={code} on>
          {code}
        </Check>
      ))}
    </>
  );

  return (
    <div className="asr-doc">
      <table className="asr-page">
        {/* Running толгой — ЗОРИУДААР гадна хүснэгтийн <thead> дотор: Chrome нь
            thead-ийг хуудас бүрт дахин зурдаг тул хоёр хуудас болоход
            давтагдана.  `position: fixed` + сөрөг top аргыг туршиж үзсэн —
            Chrome нь хуудасны хүрээнээс гадуурх fixed элементийг ТАЙРДАГ тул
            PDF-д толгой бүрмөсөн гардаггүй байсан.

            Хэлбэр нь Word загварын толгой (файлын толгойн тайлбарыг үз):
            5-р хуудсан дээр ч аль тайлангийн хуудас вэ гэдэг нь Doc. No.-оор
            цаасан дээр мэдэгдэнэ. */}
        <thead>
          <tr>
            <th className="asr-headcell">
              <AsrRunningHeader entry={entry} projectName={codeName} />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              {/* ── МАЯГТЫН ХҮСНЭГТ = Word загварын (`public/asr-template.docx`)
                  12 баганат сүлжээ (эзний зураг 2026-09-28): баганын өргөн нь
                  `GRID_COLS`, нүд бүрийн colSpan нь загварын gridSpan-тай ЯГ
                  ижил — Шифр | Гэрээний дугаар (0363) нэг мөрөнд, доор нь
                  Тайлбар ба «Бичиг баримтын төрөл» шошго хоёулаа 2 мөр дамжиж,
                  6 чагт 3×2 нүдэнд; «Хяналтаар явсан» 7 нүдэнд.  Англи дэд шошго БАЙХГҮЙ (загварт байхгүй).
                  Төслийн мэдээллийн мөрүүд (эзэн ҮЛДЭЭХЭЭР сонгосон; «Албан ёсны
                  нэр», «Байршил» 2026-09-28-нд хасагдсан) эхний
                  мөрийн ДАРАА — Word экспортын `formInfoRows`-ийн ихэр.
                  «Тайлангийн №» мөр БАЙХГҮЙ — дугаар толгойн Doc. No.-д. ── */}
              <table className="asr-t asr-form">
                <colgroup>
                  {GRID_COLS.map((w, i) => (
                    <col key={i} style={{ width: `${((w / GRID_TOTAL) * 100).toFixed(3)}%` }} />
                  ))}
                </colgroup>
                <tbody>
                  <tr>
                    <FLbl>Төслийн нэр</FLbl>
                    <td colSpan={6} className="asr-wrap asr-form-name">
                      {projectName}
                    </td>
                    <FLbl>Он сар өдөр</FLbl>
                    <td colSpan={4} className="asr-num">
                      {tableDate(entry.report_date)}
                    </td>
                  </tr>
                  {/* Хяналтын төрөл (0362, эзний шийдвэр 2026-09-29) — Word
                      загварт байхгүй мөр; төслийн мэдээлэлтэй ижил зарчмаар
                      эхний мөрийн ДАРАА, бүтэн өргөнөөр (Word-ийн
                      `formTypeRow`-ийн ихэр). */}
                  <tr>
                    <FLbl>Хяналтын төрөл</FLbl>
                    <td colSpan={11} className="asr-typecell">
                      {ASR_REPORT_TYPES.map((k) => (
                        <Check key={k} on={reportType === k}>
                          {REPORT_TYPE_LABEL_MN[k]}
                          {k === 'online' && reportType === 'online' && platform
                            ? ` (${platform})`
                            : ''}
                        </Check>
                      ))}
                    </td>
                  </tr>
                  {pairInfoRows(infoRows).map(
                    (row) => (
                      <tr key={row.left.label}>
                        <FLbl>{row.left.label}</FLbl>
                        {row.full || !row.right ? (
                          <td colSpan={11} className="asr-wrap">
                            {row.left.value}
                          </td>
                        ) : (
                          <>
                            <td colSpan={6} className="asr-wrap">
                              {row.left.value}
                            </td>
                            <FLbl>{row.right.label}</FLbl>
                            <td colSpan={4} className="asr-wrap">
                              {row.right.value}
                            </td>
                          </>
                        )}
                      </tr>
                    ),
                  )}
                  {/* Шифр | Гэрээний дугаар (0363, эзний хүсэлт 2026-09-29) —
                      Word экспортын ихэр мөр (`buildAsrDocx.ts`). */}
                  <tr>
                    <FLbl>Шифр</FLbl>
                    <td colSpan={3} className="asr-num">
                      {shifr}
                    </td>
                    <FLbl colSpan={4}>Гэрээний дугаар</FLbl>
                    <td colSpan={4} className="asr-num asr-wrap">
                      {contractNo}
                    </td>
                  </tr>
                  {meeting ? (
                    /* Оффис уулзалтын мэдээлэл (0367) — эзний Word уулзалтын
                       тэмдэглэлийн хүснэгт; «Өдөр» нь эхний мөрийн «Он сар
                       өдөр».  Word-ийн `meetingFormRows`-ийн ихэр. */
                    <>
                      <tr>
                        <FLbl>{MEETING_LABEL.place}</FLbl>
                        <td colSpan={6} className="asr-wrap">
                          {(entry.meeting_place ?? '').trim()}
                        </td>
                        <FLbl>{MEETING_LABEL.time}</FLbl>
                        <td colSpan={4} className="asr-num">
                          {meetingTimeRange(entry.meeting_start, entry.meeting_end)}
                        </td>
                      </tr>
                      <tr>
                        <FLbl>{MEETING_LABEL.parties}</FLbl>
                        <td colSpan={11} className="asr-wrap">
                          {meetingPartiesText(entry)}
                        </td>
                      </tr>
                      <tr>
                        <FLbl>{MEETING_LABEL.purpose}</FLbl>
                        <td colSpan={11} className="asr-wrap">
                          {(entry.meeting_purpose ?? '').trim()}
                        </td>
                      </tr>
                    </>
                  ) : (
                    <>
                      {/* Тайлбар ба «Бичиг баримтын төрөл» хоёулаа 2 мөр дамжина —
                          ижил өндөртэй; 6 чагт 3×2 нүдэнд.  Тайлбар урт бол илүү
                          өндрийг браузер хоёр чагтын мөрөнд ТЭНЦҮҮ хуваана (хоёр мөр
                          ижил агуулгатай — Chrome илүүдлийг мөрийн өндрийн харьцаагаар
                          хуваадаг, хэмжсэн) — «Ажлын зураг» мөр «Төлөвлөлт» мөртэй ижил. */}
                      {DOC_KIND_ROWS.map((kindRow, ri) => (
                        <tr key={ri}>
                          {ri === 0 && (
                            <>
                              <FLbl rowSpan={2}>Тайлбар</FLbl>
                              <td colSpan={3} rowSpan={2} className="asr-wrap">
                                {description}
                              </td>
                              <FLbl colSpan={4} rowSpan={2}>
                                Бичиг баримтын төрөл
                              </FLbl>
                            </>
                          )}
                          {kindRow.map((k, ki) => (
                            <td key={k.key} colSpan={ki === 0 ? 2 : undefined} className="asr-cbcell">
                              <Check on={kinds.has(k.key as AsrDocKind)}>{k.label}</Check>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </>
                  )}
                  {meeting ? (
                    /* «Оролцсон» мөр хэвлэлтэд ГАРАХГҮЙ (эзэн 2026-10-12): тэр хүмүүс
                       «Оролцогч тал» нүдэнд байгууллагатайгаа аль хэдийн бичигдсэн
                       (`meetingPartiesText`) ба хөлд гарын үсгийн мөртэйгөө. */
                    null
                  ) : (
                    <tr>
                      <FLbl>Хяналтаар явсан</FLbl>
                      {VISITED_TEAM_CELLS.map((c, i) => (
                        <td
                          key={c.label}
                          colSpan={c.span > 1 ? c.span : undefined}
                          className="asr-cbcell"
                        >
                          <Check on={!!c.code && picked.has(c.code)}>{c.label}</Check>
                          {/* Загварт нүдгүй багууд (АУ, ЦАХ …) сүүлийн нүдэнд — Word-той ижил. */}
                          {i === VISITED_TEAM_CELLS.length - 1 &&
                            visitedExtras.map((code) => (
                              <Check key={code} on>
                                {templateTeamLabel(code)}
                              </Check>
                            ))}
                        </td>
                      ))}
                    </tr>
                  )}
                  {/* «Шалгасан | Баталсан» — оффис уулзалтад БАЙХГҮЙ (эзэн 2026-10-08;
                      Word-ийн ихэр `buildAsrDocx.ts`). */}
                  {!meeting && (
                    <tr>
                      <FLbl>Шалгасан</FLbl>
                      <td colSpan={5} className="asr-checked">
                        <div>
                          {[entry.checked_by_name, entry.checked_by_title].filter(Boolean).join(' / ')}
                        </div>
                        {/* «Шалгасан» ГАРЫН ҮСЭГ — зөвхөн БАТАЛСАН тайлан дээр.  Нэрийг
                            ХЭВЭЭР харуулна: тэр бол хэн шалгахыг заасан талбар, гарын
                            үсэг нь шалгасан ГЭДЭГ БАТАЛГАА. */}
                        {entry.status === 'approved' && entry.checked_by_signature_url && (
                          <HandSignature src={mediaUrl(entry.checked_by_signature_url)} fitToInk="document" />
                        )}
                      </td>
                      <FLbl colSpan={2}>Баталсан</FLbl>
                      <td colSpan={4} className="asr-approved">
                        {/* ⚠️ КОМПАНИЙН ТАМГА ЭНД ГАРАХГҮЙ (эзний шийдвэр 2026-09-23):
                            зохиогчийн хяналтын тайлан бол дотоод баримт — батлагдсаныг
                            батлагчийн НЭР илэрхийлнэ (`entry.stamp_url` backend-д хэвээр). */}
                        {entry.status === 'approved' ? (entry.reviewer_name ?? '') : ''}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* ── АЖЛЫН ТАЙЛАН: жишээний 3-р блок.  Хар-хөх тууз + багийн
                  чагтны мөр + нэг хүрээтэй бие.  Бие дотор дэд гарчгууд нь
                  тод-налуу мөр (тууз БИШ) — жишээний «Хяналтаар гарсан
                  шийдвэрлэх асуудлууд:» яг тэр хэлбэр.

                  ⚠️ Эзний 2026-09-23-ны шийдвэрээр жишээний 2-р блок
                  («Зохиогчийн хяналтыг … гүйцэтгэлээ» + ажлын явцын жагсаалт
                  + Attachment) ОГТ БАЙХГҮЙ.  `work_report` нь энэ биеийн
                  ЭХНИЙ догол мөр болж орж байгаа тул өгөгдөл алдагдахгүй. ── */}
              {meeting ? (
                /* Оффис уулзалт (0367) — «Уулзалтын агуулга»: асуултгүй, ганц
                   бичвэр (`work_report`).  Багийн чагт 2026-10-08-наас ГАРАХГҮЙ
                   (эзэн) — баг нь дугаарлалтад л (толгойн Doc. No.). */
                <section className="asr-block asr-block--work">
                  <div className="asr-band">
                    <span className="asr-band-mn">{MEETING_LABEL.content}</span>
                    <span className="asr-band-en">{MEETING_LABEL.contentEn}</span>
                  </div>
                  <div className="asr-workbody">
                    {/* 0396 — «0.1 Захиалагч / 0.2 Гүйцэтгэгч» хүснэгтүүд эхэнд. */}
                    {requestSections.map((sec) => (
                      <MeetingRequestTable key={sec.side} sec={sec} />
                    ))}
                    {/* «Тайлбар: …» — эзний RFI/тэмдэглэлийн хэлбэр (тод шошго + энгийн бичвэр). */}
                    {workReport && (
                      <div className="asr-meet-note asr-wrap">
                        <span className="asr-meet-note-k">{MEETING_LABEL.notesHead}:</span> {workReport}
                      </div>
                    )}
                    <ItemImages urls={entry.meeting_doc?.note_images ?? []} />
                  </div>
                </section>
              ) : (
                <section className="asr-block asr-block--work">
                  <div className="asr-band">
                    <span className="asr-band-mn">Ажлын тайлан</span>
                    <span className="asr-band-en">Work report</span>
                  </div>
                  <div className="asr-workteams">{teamChecks}</div>
                  {/* Бичих талбай: агуулга урт бол хуудсаар ҮРГЭЛЖИЛНЭ (толгой нь
                      гадна хүснэгтийн thead-д тул шинэ хуудсанд дахин зурагдана);
                      хоосон бол гараар бичих доод өндөртэй (min-height). */}
                  <div className="asr-workbody">
                    {workReport && <div className="asr-p asr-wrap">{workReport}</div>}
                    {withNotes.map((t) => (
                      <div key={t.team_id} className="asr-note">
                        <span className="asr-note-team">{templateTeamLabel(t.team_code)}</span>
                        <span className="asr-note-text asr-p asr-wrap">{t.work_note}</span>
                      </div>
                    ))}

                    {/* Дэд хэсгүүд (0336).  Хоосон нь ч ГАРНА — цаасан дээр гараар
                        нөхөх зай, мөн «энэ хэсэг байх ёстой» гэдгийг уншигч мэднэ. */}
                    <WorkHead mn="Талбай дээр өгсөн үүрэг даалгавар" en="Site instructions" />
                    {siteTasks ? (
                      <div className="asr-p asr-wrap">{siteTasks}</div>
                    ) : (
                      <div className="asr-p asr-empty">—</div>
                    )}

                    {/* ⚠️ Нэр нь 0336-д эзний өгсөн «Илэрсэн алдаа, дутагдал» ХЭВЭЭР.
                        Жишээ баримт дээр энэ хэсгийг «Хяналтаар гарсан шийдвэрлэх
                        асуудлууд» гэж нэрлэсэн боловч засварлагчийн талбарын нэр
                        тэр хэвээр тул цаасан дээр өөр нэр гарвал инженер аль
                        талбар нь хаана хэвлэгдэхийг андуурна. */}
                    <WorkHead mn="Илэрсэн алдаа, дутагдал" en="Defects found" />
                    {defects ? (
                      <div className="asr-p asr-wrap">{defects}</div>
                    ) : (
                      <div className="asr-p asr-empty">—</div>
                    )}
                    {/* Энэ тайлангийн асуудлыг ДАРААГИЙН тайлан шийдсэн бол — сервер
                        гарган авсан холбоос (энэ тайлангийн мөр хөндөгдөөгүй). */}
                    {resolvedIn.length > 0 && (
                      <ul className="asr-resolved-in">
                        {resolvedIn.map((r, i) => (
                          <li key={`${r.report_id}-${i}`}>
                            <span className="asr-resolved-in-k">Шийдсэн:</span>{' '}
                            <span className="asr-strong">{r.doc_no ?? '—'}</span> ·{' '}
                            {tableDate(r.report_date)}
                            {r.resolution_text ? ` — ${r.resolution_text}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}

                    <WorkHead
                      mn="Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн"
                      en="Resolution of previous report issues"
                    />
                    {resolutions.length === 0 ? (
                      <div className="asr-p asr-empty">—</div>
                    ) : (
                      <table className="asr-t asr-res">
                        <colgroup>
                          <col style={{ width: '20%' }} />
                          <col style={{ width: '38%' }} />
                          <col style={{ width: '42%' }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <Lbl mn="Өмнөх тайлан" en="Report" />
                            <Lbl mn="Асуудал" en="Issue" />
                            <Lbl mn="Шийдэл" en="Resolution" />
                          </tr>
                        </thead>
                        <tbody>
                          {resolutions.map((r, i) => (
                            <tr key={r.id ?? i}>
                              <td className="asr-num asr-res-ref">
                                <div className="asr-strong">{r.prev_doc_no ?? '—'}</div>
                                {r.prev_report_date && <div>{tableDate(r.prev_report_date)}</div>}
                              </td>
                              <td className="asr-wrap">{r.issue_text || ''}</td>
                              <td className="asr-wrap">{r.resolution_text || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              )}

              {/* ── ГАРЫН ҮСЭГ: жишээний 4-р блок.  Лого 2026-09-28-наас толгойд. ── */}
              {meeting && <MeetingFooterBlock entry={entry} />}
              {!meeting && (
              <section className="asr-block asr-block--sign">
                <div className="asr-sign-wrap">
                  <table className="asr-t asr-box asr-sign">
                    <colgroup>
                      <col style={{ width: '26%' }} />
                      <col style={{ width: '28%' }} />
                      <col style={{ width: '26%' }} />
                      <col style={{ width: '20%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <Lbl mn="Хяналт хийсэн" en="Role" className="asr-mid" />
                        <Lbl mn="Овог, нэр" en="Name" className="asr-mid" />
                        <Lbl mn="Гарын үсэг" en="Signature" className="asr-mid" />
                        <Lbl mn="Он сар өдөр" en="Date" className="asr-mid" />
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          [
                            'Архитектор, Инженер',
                            entry.sig_arch_name,
                            entry.sig_arch_url,
                            entry.sig_arch_date,
                          ],
                          [
                            'Талбайн Инженер',
                            entry.sig_site_name,
                            entry.sig_site_url,
                            entry.sig_site_date,
                          ],
                        ] as const
                      ).map(([role, name, url, date]) => (
                        <tr key={role}>
                          <Lbl mn={role} className="asr-mid asr-lbl-role" />
                          <td className="asr-mid">
                            {name || ''}
                          </td>
                          <td className="asr-sig">{url && <HandSignature src={mediaUrl(url)} fitToInk="document" />}</td>
                          <td className="asr-mid asr-num">
                            {tableDate(date) === '20__.__.__' ? '' : tableDate(date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              )}

              {/* ── Улаан дэвтэр (0279) — ҮРГЭЛЖ гарна: «Гарын үсэг дутуу» гэдэг нь
                  баримт дээр ил байх ёстой мэдээлэл (эзний урсгал 2026-09-10,
                  2026-09-23-нд ҮЛДЭЭХЭЭР дахин батлагдсан).  Оффис уулзалтад огт
                  гарахгүй (эзэн 2026-09-30, 0367). ── */}
              {!meeting && (
                <section className="asr-block asr-block--redbook">
                  <table className="asr-t asr-box">
                    <colgroup>
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '78%' }} />
                    </colgroup>
                    <tbody>
                      <tr>
                        <Lbl mn="Улаан дэвтэр" en="Red book" />
                        <td className="asr-checks">
                          <Check on={redBook === 'verified'}>{RED_BOOK_LABEL[redBook]}</Check>
                        </td>
                      </tr>
                      {redBook === 'verified' && (
                        <tr>
                          <Lbl mn="Баталгаажуулсан" en="Verified by" />
                          <td className="asr-wrap">
                            {/* `formatDate` нь UTC агшныг хөтчийн (хэвлэх үед серверийн)
                                хуанлийн өдөрт буулгана — `tableDate` нь зөвхөн YYYY-MM-DD
                                хүлээдэг тул ISO агшинг шууд өгч болохгүй. */}
                            {[
                              entry.red_book_verifier_name,
                              tableDate(formatDate(entry.red_book_verified_at)),
                            ]
                              .filter((x) => x && x !== '20__.__.__')
                              .join(' · ')}
                          </td>
                        </tr>
                      )}
                      {entry.red_book_photo_url && (
                        <tr>
                          <Lbl mn="Дэвтрийн зураг" en="Photo" />
                          <td className="asr-redbook-photocell">
                            <img
                              className="asr-redbook-photo"
                              src={mediaUrl(entry.red_book_photo_url)}
                              alt=""
                            />
                          </td>
                        </tr>
                      )}
                      {(entry.companions ?? []).map((c) => (
                        <tr key={c.user_id}>
                          <Lbl mn={c.full_name ?? '—'} en="With" />
                          <td className="asr-wrap">
                            {RED_BOOK_LABEL[redBookStatusOf(c)]}
                            {c.red_book_photo_url && (
                              <img
                                className="asr-redbook-photo"
                                src={mediaUrl(c.red_book_photo_url)}
                                alt=""
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* ── ЗУРГИЙН ХУУДАС: ХУУДАС ТУС БҮРД ЯГ 4 (2×2), зураг бүр
                  тайлбартай.  Эзэн 2026-09-23-нд «энэ боломжийг хэвээр
                  үлдээ» гэж ИЛ хэлсэн — бүү хураангуйл.

                  Жишээ баримтын зургийн хуудас бүр толгойн доор «Төслийн нэр |
                  <НЭР>» гэсэн нэг мөртэй — тэр нь хуудсыг өөрийг нь таниулдаг
                  (running толгойд төслийн нэр байхгүй).  Мөн жишээний хуудсан
                  дээрх НЭГ ерөнхий тайлбарын оронд бидэнд ЗУРАГ БҮРИЙН
                  тайлбар байна — энэ бол илүү нарийн мэдээлэл, буурахгүй.

                  Гарын үсгийн ДАРАА хавсралт болж орно: 4 зургийн хуудас нь
                  бүтэн хуудас эзэлдэг тул текстийн дунд байрлуулбал өмнөх
                  хуудасны тал нь хоосон үлдэнэ.  Хуудас бүр `break-before:
                  page` (asrPrintStyles.ts). ── */}
              {photoSheets.length > 0 && (
                <section className="asr-block asr-block--photos">
                  {photoSheets.map((sheet, si) => (
                    <div key={si} className="asr-photo-sheet">
                      <table className="asr-t asr-box asr-photohead">
                        <colgroup>
                          <col style={{ width: '22%' }} />
                          <col style={{ width: '58%' }} />
                          <col style={{ width: '20%' }} />
                        </colgroup>
                        <tbody>
                          <tr>
                            <Lbl mn="Төслийн нэр" en="Project" />
                            <td className="asr-wrap asr-strong">{projectName}</td>
                            <td className="asr-num asr-photo-sheet-no">
                              {/* Оффис уулзалтын ганц зурагт тоолуур хэрэггүй (Word-той ижил). */}
                              {meeting && entry.photos.length === 1 ? null : (
                                <>
                                  Зураг {si * sheetSize + 1}–{si * sheetSize + sheet.length} /{' '}
                                  {entry.photos.length}
                                </>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <div className={meeting ? 'asr-photos asr-photos--single' : 'asr-photos'}>
                        {sheet.map((p, j) => {
                          const i = si * sheetSize + j;
                          const s = photoStamp(
                            {
                              reportDate: entry.report_date,
                              shifr: shifr ?? entry.shifr,
                              projectName,
                              seq: entry.seq,
                            },
                            p,
                          );
                          const caption = (p.caption ?? '').trim();
                          return (
                            <figure
                              key={`${p.url}-${i}`}
                              className={meeting ? 'asr-photo asr-photo--single' : 'asr-photo'}
                            >
                              <div className="asr-photo-box">
                                {/* Тэмдэг нь ЗУРАГ ДЭЭР, баруун доод буланд (хүрээ нь
                                    зургийн хэмжээтэй — asrPrintStyles.ts). */}
                                <div className="asr-photo-frame">
                                  <img src={mediaUrl(p.url)} alt={p.name} />
                                  {(s.when || s.project) && (
                                    <div className="asr-photo-stamp">
                                      {s.when && <span className="asr-photo-when">{s.when}</span>}
                                      {s.project && (
                                        <span className="asr-photo-project">{s.project}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {meeting ? (
                                /* Оффис уулзалт — тайлбар нь АВТОМАТ: төслийн
                                   нэр · он сар өдөр цаг:мин:сек (эзэн 2026-09-30). */
                                <figcaption>
                                  <span className="asr-photo-cap-text">
                                    {[s.project, s.when].filter(Boolean).join(' · ')}
                                  </span>
                                </figcaption>
                              ) : (
                                <figcaption>
                                  <span className="asr-photo-cap-no">
                                    {String(i + 1).padStart(2, '0')}
                                  </span>
                                  <span
                                    className={caption ? 'asr-photo-cap-text' : 'asr-photo-cap-empty'}
                                  >
                                    {caption || 'Тайлбар: ____________________'}
                                  </span>
                                </figcaption>
                              )}
                            </figure>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </td>
          </tr>
        </tbody>
        {/* Хуудас бүрийн ДООД зай (хэвлэхэд л өндөртэй — asrPrintStyles.ts).
            @page-ийн зай 0 тул браузер огноо / URL / «1/2»-оо зурах газаргүй;
            жинхэнэ зай нь энэ давтагдах tfoot ба thead-ийн дээд padding. */}
        <tfoot>
          <tr>
            <td className="asr-footcell" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
