/* =============================================================
 * «1. Төслийн танилцуулга» хуудас.
 * -------------------------------------------------------------
 * Бүтэц нь 251030_MGL_PD_MAX_URGUU.docx жишиг тайлангаас
 * ХУУЛБАРЛАГДСАН:
 *
 *   1.1  General Information   — хоёр баганат «паспорт» хүснэгт, доор
 *                                нь дугааргүй «Бичиг баримт» хүснэгт
 *   1.2  Scope of work         — дисциплин бүрийн тодорхойлолт,
 *                                хариуцсан ахлах, өнгөөр хуваасан
 *                                файлын нэрийн загвар
 *   1.3  Project Timeline      — гарчгийн хажууд (баруун талд)
 *                                «Зургийн файл хадгалах загвар»
 *                                ХҮРЭЭГҮЙ блок, доор нь зэрэгцээ хоёр
 *                                хүснэгт (төслийн хугацаа / уулзалтын хуваарь)
 *
 * Урьд нь 1.2 (Scope of work) хэсэг ОГТ render хийгддэггүй (`teamScopes`
 * prop ирдэг мөртлөө хэрэглэгддэггүй), дугаарлалт нь 1.1 → 1.2(Timeline)
 * гэж алгасдаг, файлын нэрийн хайрцаг ерөөсөө байхгүй байв.
 *
 * ЗАСВАРЛАХ ЗАРЧИМ:
 *   • Утга бүр `<EditableText>` — `onChange` өгвөл хуудсан дээрээ шууд
 *     засагдана, `disabled` эсвэл `onChange` байхгүй бол зөвхөн уншина
 *     (хэвлэх хуудас, PDF, issued тайлан).
 *   • `onChange` нь ЗӨВХӨН өөрчлөгдсөн талбарын patch-ийг өгнө.  Мөр
 *     засах/нэмэх/хасах үед тухайн массивын шинэ хуулбарыг бүтнээр өгнө
 *     (`IntroOverride`-д массив бүхэлдээ хадгалагддаг).
 *   • Мөр нэмэх/хасах товч, сонгогдоогүй дисциплин зэрэг ЗАСВАРЛАХ
 *     туслахууд `@media print` дотор бүгд алга болно (introStyles.ts).
 *
 * ⚠️ ШОШГО vs ӨГӨГДӨЛ — ХОЁРЫГ ХЭЗЭЭ Ч ДАВХАРЛАХГҮЙ:
 *   • СТАТИК ШОШГО (эх код дахь литерал: «Project title:», «№»,
 *     «1.2. Scope of work», толгойн монгол хаалтууд …) →  `<T k="…">`
 *     (`lib/reportText.tsx`).  Утга нь блокийн `content.textOverrides`-д
 *     ТҮЛХҮҮРЭЭРЭЭ хадгалагдана.
 *   • ӨГӨГДӨЛ (`IntroModel`-ийн талбар бүр: паспортын утга, бичиг
 *     баримт/scope/timeline/meeting мөрүүд, timeline-ийн `labelEn` ба
 *     `labelMn`, файлын нэрийн тайлбар блок) →  `<EditableText>`, утга нь
 *     `IntroOverride`-д хадгалагдана.
 *   Нэг текстийг хоёуланд нь өгвөл хоёр өөр газар хоёр өөр утга хадгалагдаж
 *   аль нь хожихыг таах боломжгүй болно.  Тиймээс «Start / Finish /
 *   Extension» ба «(Эхлэх) / (Дуусах) / (Сунгалт)» нь МӨРИЙН ӨГӨГДӨЛ тул
 *   `T` БИШ, `EditableText` хэвээр.
 *
 * A4 ХУУДАСЛАЛТ: тасалж болох нэгж бүр дээр `data-a4-item` байх ёстой —
 * A4Paginator үүгээр хуудас тасалдаг.  Бичиг баримтын хүснэгт нэг A4-т
 * багтахааргүй урт болсон үед тэмдэглэгээг хүснэгтээс АВЧ мөр бүр дээр
 * тавина (`DOC_FLOW_THRESHOLD`) — ингэснээр мөрөөр урсана.  Хоёуланд нь
 * тавьбал пагинатор агуулгыг давхардуулах тул үргэлж НЭГИЙГ нь л тавина.
 * 1.2 Scope of work хүснэгт мөн ижил дүрэмтэй (`SCOPE_FLOW_THRESHOLD`):
 * урсгалтай үед `.perf-intro__group`-ийн тэмдэглэгээг АВЧ, гарчиг ба мөр
 * бүр дээр тавина — эс тэгвэл бүлэг бүхэлдээ дараагийн хуудас руу үсэрч
 * өмнөх хуудсыг хоосон үлдээнэ.  Тэмдэглэгээг АВАХ нь зөвхөн ДЭЛГЭЦИЙН
 * пагинаторт үйлчилдэг тул тэр үед `.perf-intro__group--flow` классыг мөн
 * өгч хэвлэлийн `break-inside: avoid`-ыг цуцална (introStyles.ts).
 *
 * ⚠️ НЭГЖИЙН ХЭМЖЭЭ = ХООСОН ЗАЙ (2026-08-25).  Пагинатор нэгжийг
 * ХЭСЭГЧИЛЖ ТАСАЛДАГГҮЙ — багтахгүй бол БҮТНЭЭР нь дараагийн хуудас руу
 * түлхэнэ.  Иймд 90mm-ийн атом нэгж нь өмнөх хуудсанд 80mm сул зай
 * үлдээж чадна.  1.3-ын бүлэг яг тийм байсныг ХОЁР жижиг нэгж болгон
 * задлав (гарчгийн эгнээ ~30mm + зэрэгцээ хүснэгтүүд ~50mm).  Шинэ хэсэг
 * нэмэхдээ: бүлэг бүхэлдээ БИШ, дотоод мөр/эгнээ бүр дээр тэмдэглэ.
 *
 * ПАГИНАТОРЫН ХҮСНЭГТИЙН ГОРИМ:  `A4Paginator.collect()` нь хүснэгт нэг
 * A4-т БАГТВАЛ бүтэн нэгж болгоно, УРТ бол хуудасны эхэнд түлхээд мөр
 * бүрийг нь `collectRows`-оор тусад нь хуудаслана.  Тиймээс `<tr>` дээрх
 * тэмдэглэгээ нь пагинаторт заавал шаардлагагүй боловч хэвлэлийн
 * `tr { break-inside: avoid }`-той нэг утгыг илэрхийлэх тул хэвээр үлдээв.
 * ХЭМЖЭЭ: баганы өргөн, үсгийн хэмжээ, өнгө бүгд жишиг docx-ийн
 * `w:tblGrid` / `w:sz` / run өнгөөс авсан (introStyles.ts ба `COL_*`
 * тогтмолууд).  Агуулгын багана нийт ≈170mm.
 * ============================================================= */

import type { ReactNode } from 'react';

import { PageHeader, PageFooter } from '@/features/performance-reports/components/TableOfContents';
import { EditableText } from '@/features/performance-reports/components/EditableText';
import { toDottedDate } from '@/shared/lib/dottedDate';
import { T, useReportText } from '@/features/performance-reports/lib/reportText';
import {
  INTRO_DISCIPLINES,
  DISCIPLINE_LABEL,
  rowId,
  type IntroDocRow,
  type IntroMeetingRow,
  type IntroModel,
  type IntroOverride,
  type IntroScopeRow,
  type IntroTimelineRow,
} from '@/features/performance-reports/types/introOverride';

export interface ProjectIntroPageProps {
  reportNo: number;
  reportDate: string;
  drawingNo: string | null;
  model: IntroModel;
  onChange?: (patch: Partial<IntroOverride>) => void;
  disabled?: boolean;
  /** Паспортын маягтад «Хариуцсан мэргэжилтэн» баганыг ХООСОН мөрөнд ч
   *  үзүүлнэ.  ТАЙЛАНД өгөхгүй — тэнд багана нь зөвхөн утга байхад гарч,
   *  аль хэдийн гаргасан баримтын байрлалыг хөдөлгөхгүй. */
  alwaysShowSpecialist?: boolean;
  /** Засварлах горимд ч ЗӨВХӨН УНШИГДАХ нүднүүд.  Байгаа төслийн «Мэдээлэл»
   *  таб дээр «Location» нь `projects`-д амьдардаг тул паспортын хадгалалтаар
   *  бичигдэхгүй — түүнийг энд түгжинэ, эс бөгөөс бичсэн нь Хадгалахад
   *  чимээгүй алга болно.  («Client» 2026-09-28-аас засагдана —
   *  `passportDoc.ts`-ийн `LOCKED_FIELDS`-ийг үз.) */
  lockedFields?: readonly ScalarKey[];
}

/** Патч илгээгч. `undefined` бол хуудас зөвхөн уншигдана. */
type Emit = (patch: Partial<IntroOverride>) => void;

/** Паспорт хүснэгтийн нэг мөрт багтдаг энгийн текст талбарууд. */
export type ScalarKey =
  | 'projectTitle'
  | 'clientName'
  | 'drawingNo'
  | 'scope'
  | 'location'
  | 'director'
  | 'ceo';

/** Бичиг баримтын хүснэгт хэдэн мөрөөс хойш «мөрөөр урсах» вэ.
 *  Үүнээс богино бол хүснэгт бүхэлдээ нэг `data-a4-item`. */
const DOC_FLOW_THRESHOLD = 12;

/** 1.2 Scope of work хүснэгтийн ижил хязгаар.  Дисциплин олонтой том
 *  төсөл дээр энэ хүснэгт нэг A4-т багтахаа болих тул тэмдэглэгээг
 *  бүлгээс АВЧ гарчиг + мөр бүр дээр тавина (`docsFlow`-той ижил дүрэм). */
const SCOPE_FLOW_THRESHOLD = 12;

/* ---------- хоосон мөр үүсгэгчид ---------- */

const blankDoc = (): IntroDocRow => ({
  id: rowId('doc'),
  name: '',
  no: '',
  date: '',
  description: '',
});

const blankScope = (): IntroScopeRow => ({
  id: rowId('sc'),
  code: '',
  codeLabel: '',
  identification: '',
  leader: '',
  specialist: '',
  fileName: '',
});

const blankTimeline = (): IntroTimelineRow => ({
  id: rowId('tl'),
  labelEn: '',
  labelMn: '',
  date: '',
});

const blankMeeting = (): IntroMeetingRow => ({ id: rowId('mt'), label: '', date: '' });

/** `index`-ийн ДАРАА шинэ мөр оруулсан шинэ массив. */
function insertAt<T>(rows: readonly T[], index: number, row: T): T[] {
  const next = rows.slice();
  next.splice(index + 1, 0, row);
  return next;
}

/* ---------- баганы ЯГ өргөн (жишиг docx-ийн w:tblGrid) ---------- */

/** Жишиг баримтын баганы өргөнүүд (mm).  `table-layout: fixed`-тэй хамт
 *  л ажиллана (introStyles.ts → `.perf-table--intro`).
 *
 *  ⚠️ ЗАСВАРЛАХ товчны багана энд ОРОХГҮЙ: fixed layout-д тодорхойлоогүй
 *  багана 0 өргөнтэй болж, товчнууд хүснэгтийн баруун захаас гадагш
 *  хуудасны сул зайд «унжина» — баримтын харагдац хөдлөхгүй. */
const COL_PASSPORT = [38.88, 56.29, 38.19, 36.88] as const; // = 170.24mm
const COL_DOCS = [7.23, 50.52, 31.15, 44.45, 36.88] as const; // = 170.23mm
const COL_SCOPE = [7.85, 14.29, 39.69, 31.75, 76.29] as const; // = 169.86mm
/* Жишиг Word баримтад «Хариуцсан мэргэжилтэн» гэсэн 2 дахь нэрийн багана
 * байдаг.  Багана нь ЗӨВХӨН аль нэг мөрөнд утга байхад л гарна (доорх
 * `hasSpecialist`) — ингэснээр аль хэдийн ГАРГАСАН тайлангийн байрлал
 * хөдлөхгүй.  Нийт өргөн ижил 169.86mm: файлын нэрийн баганаас хуваав. */
const COL_SCOPE_SPEC = [7.85, 14.29, 32.0, 27.0, 27.0, 61.72] as const; // = 169.86mm
const COL_TIMELINE = [10, 45.71, 30] as const; // = 85.71mm
const COL_MEETING = [10, 38.15, 30] as const; // = 78.15mm

const sum = (w: readonly number[]) => w.reduce((a, b) => a + b, 0);

function Cols({ widths }: { widths: readonly number[] }) {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: `${w}mm` }} />
      ))}
    </colgroup>
  );
}

/** Хүснэгтийн нийт өргөнийг баганы нийлбэрээр тогтооно. */
const tableStyle = (widths: readonly number[]) => ({ width: `${sum(widths)}mm` });

/* ---------- файлын нэрийн өнгө хуваалт ---------- */

/**
 * «240918_MAX_URGUU_EZ_A» → өнгөт хэсгүүд.  Жишиг docx-ийн run өнгө:
 *
 *   YYMMDD_        #000 (үндсэн)
 *   PROJECT ID_    #4F81BD
 *   DISCIPLINE     #C0504D
 *   _              #000
 *   REVISION NO*.  #8064A2
 *
 * PROJECT ID нь өөрөө «_» агуулж болох тул (MAX_URGUU) хуваалтыг ЭХНИЙ
 * ба СҮҮЛИЙН ХОЁР «_»-оор хийнэ.  Хэв маягт таарахгүй (гурваас цөөн «_»)
 * бол бүтнээр нь буцаана — өнгө алдагдана, текст АЛДАГДАХГҮЙ.
 */
function renderFileName(name: string): ReactNode {
  const first = name.indexOf('_');
  const last = name.lastIndexOf('_');
  const prev = last > 0 ? name.lastIndexOf('_', last - 1) : -1;
  if (first < 0 || prev <= first || last <= prev) return name;
  return (
    <>
      {name.slice(0, first + 1)}
      <span className="perf-fname__proj">{name.slice(first + 1, prev + 1)}</span>
      <span className="perf-fname__disc">{name.slice(prev + 1, last)}</span>
      {'_'}
      <span className="perf-fname__rev">{name.slice(last + 1)}</span>
    </>
  );
}

/* ---------- зөвхөн засварлах горимд харагдах туслах элементүүд ---------- */

/** Мөрийн баруун захын `+` / `×`. Хүснэгтийн хүрээнээс ГАДУУР суух тул
 *  баримтын харагдацыг өөрчлөхгүй, хэвлэхэд бүрмөсөн алга болно. */
function RowButtons({ onAdd, onRemove }: { onAdd: () => void; onRemove: () => void }) {
  return (
    <td className="perf-rowbtn-cell">
      <button type="button" className="perf-rowbtn" title="Мөр нэмэх" onClick={onAdd}>
        +
      </button>
      <button type="button" className="perf-rowbtn" title="Мөр устгах" onClick={onRemove}>
        ×
      </button>
    </td>
  );
}

/** Хоосон хүснэгт дээр эхний мөрийг нэмэх боломж (үгүй бол мөр нэмэх
 *  цорын ганц товч нь мөр дээр байдаг тул гарц үлдэхгүй). */
function AddFirstRow({ cols, onAdd }: { cols: number; onAdd: () => void }) {
  return (
    <tr className="perf-rowadd">
      <td colSpan={cols}>
        <button type="button" className="perf-rowbtn" title="Мөр нэмэх" onClick={onAdd}>
          +
        </button>
      </td>
    </tr>
  );
}

/* ============================================================= */

export function ProjectIntroPage(p: ProjectIntroPageProps) {
  const { model } = p;
  const text = useReportText();
  // `disabled` үед ямар ч патч гаргахгүй — EditableText ч зөвхөн уншина.
  const emit: Emit | undefined = p.disabled ? undefined : p.onChange;
  const editable = emit !== undefined;

  const docs = model.documents;
  const scopeRows = model.scopeRows;
  const timeline = model.timeline;
  const meetings = model.meetings;
  const note = model.fileNamingNote;

  /** Паспортын нэг талбарын setter.  Түгжсэн талбарт `undefined` —
   *  `EditableText` тэгэхэд contentEditable болохгүй, зөвхөн уншигдана. */
  const scalar = (key: ScalarKey): ((next: string) => void) | undefined =>
    emit && !p.lockedFields?.includes(key)
      ? (next: string) => emit({ [key]: next } as Partial<IntroOverride>)
      : undefined;

  /** Дисциплины ■ тэмдэглэгээг toggle хийнэ.  Хадгалахдаа
   *  INTRO_DISCIPLINES-ийн ТОГТМОЛ дарааллаар эрэмбэлнэ — дарсан дараалал
   *  харагдацад нөлөөлөх ёсгүй.  Жагсаалтад байхгүй хуучин кодыг хойно нь
   *  хэвээр үлдээнэ (өгөгдөл алдагдахгүй). */
  const toggleDiscipline = (code: string) => {
    if (!emit) return;
    const has = model.disciplines.includes(code);
    const wanted = has
      ? model.disciplines.filter((c) => c !== code)
      : [...model.disciplines, code];
    const ordered = INTRO_DISCIPLINES.map((d) => d.code).filter((c) => wanted.includes(c));
    const extras = wanted.filter((c) => !ordered.includes(c));
    emit({ disciplines: [...ordered, ...extras] });
  };

  // Засварлах үед БҮХ код харагдана (сонгогдоогүй нь бүдэг), уншихад
  // зөвхөн сонгогдсон нь.
  const shownDisciplines = editable
    ? INTRO_DISCIPLINES.map((d) => d.code)
    : INTRO_DISCIPLINES.map((d) => d.code).filter((c) => model.disciplines.includes(c));

  /* «Хариуцсан мэргэжилтэн» багана: ЗӨВХӨН өгөгдөлтэй үед.  Засварлах
   * горимд ч ижил дүрэм — эс бөгөөс preview хэвлэлээс зөрнө.  Утгыг
   * төслийн «Мэдээлэл» хуудасны 1.2-т бичнэ (эх сурвалж тэнд). */
  const hasSpecialist = !!p.alwaysShowSpecialist || scopeRows.some((s) => s.specialist.trim());
  const scopeCols: readonly number[] = hasSpecialist ? COL_SCOPE_SPEC : COL_SCOPE;

  const docsFlow = docs.length > DOC_FLOW_THRESHOLD;
  const scopeFlow = scopeRows.length > SCOPE_FLOW_THRESHOLD;

  return (
    <div className="perf-page" data-toc="intro" data-a4-break="before">
      <PageHeader reportNo={p.reportNo} reportDocNo={p.drawingNo} reportDate={p.reportDate} />

      <div className="perf-intro__section-num" data-a4-item>
        <T k="intro.h.section">1. Төслийн танилцуулга</T>
        <T k="intro.h.section.en" as="em">Project description</T>
      </div>

      {/* ================= 1.1 General Information ================= */}
      <div className="perf-intro__group" data-a4-item>
        <div className="perf-intro__sub" data-toc="s1.1">
          <T k="intro.h.11">1.1. General Information</T>{' '}
          <T k="intro.h.11.mn" as="em">(Төслийн ерөнхий мэдээлэл)</T>
        </div>

        <table
          className="perf-table perf-table--intro perf-table--passport"
          style={tableStyle(COL_PASSPORT)}
        >
          <Cols widths={COL_PASSPORT} />
          <tbody>
            <tr>
              {/* Жишигт зөвхөн «Project title» утга ТӨВЛӨРСӨН. */}
              <th>
                <T k="intro.lbl.title">Project title:</T>
                <T k="intro.lbl.title.mn" as="small">(Төслийн нэр)</T>
              </th>
              <td colSpan={3} className="perf-cell--center">
                <EditableText
                  fieldKey="intro.projectTitle"
                  value={model.projectTitle}
                  onChange={scalar('projectTitle')}
                  disabled={p.disabled}
                  placeholder="Төслийн бүтэн нэр"
                  multiline
                />
              </td>
            </tr>
            <tr>
              <th>
                <T k="intro.lbl.client">Client:</T>
                <T k="intro.lbl.client.mn" as="small">(Захиалагч)</T>
              </th>
              <td>
                <EditableText
                  fieldKey="intro.clientName"
                  value={model.clientName}
                  onChange={scalar('clientName')}
                  disabled={p.disabled}
                  placeholder="Захиалагчийн нэр"
                />
              </td>
              <th>
                <T k="intro.lbl.drawingno">Drawing No.:</T>
                <T k="intro.lbl.drawingno.mn" as="small">(Зургийн шифр)</T>
              </th>
              <td className="perf-cell--10">
                <EditableText
                  fieldKey="intro.drawingNo"
                  value={model.drawingNo}
                  onChange={scalar('drawingNo')}
                  disabled={p.disabled}
                  placeholder="Шифр"
                />
              </td>
            </tr>
            {/* «Doc. No.» мөр ХАСАГДСАН (эзний хүсэлт 2026-09-28: «DOC. NO.
                хэсгийг бүх төслөөс хас»).  Хэмжсэн: прод дээр паспортын
                `doc_no` ба тайлангийн `docNo` override аль алинд нь утга 0 —
                гаргасан тайлангийн хуудас хуваалт хөдлөхгүй.  Багана/төрөл
                хэвээр (`IntroAuto.docNo`), зөвхөн харагдац алга. */}
            <tr>
              <th>
                <T k="intro.lbl.scope">Scope of work:</T>
                <T k="intro.lbl.scope.mn" as="small">(Ажлын цар хүрээ)</T>
              </th>
              <td colSpan={3}>
                <EditableText
                  fieldKey="intro.scope"
                  value={model.scope}
                  onChange={scalar('scope')}
                  disabled={p.disabled}
                  placeholder="Ажлын цар хүрээ"
                  multiline
                />
              </td>
            </tr>
            <tr>
              <th>
                <T k="intro.lbl.location">Location:</T>
                <T k="intro.lbl.location.mn" as="small">(Байршил)</T>
              </th>
              <td colSpan={3}>
                <EditableText
                  fieldKey="intro.location"
                  value={model.location}
                  onChange={scalar('location')}
                  disabled={p.disabled}
                  placeholder="Байршил"
                  multiline
                />
              </td>
            </tr>
            <tr>
              <th>
                <T k="intro.lbl.director">Director:</T>
                <T k="intro.lbl.director.mn" as="small">(Захирал)</T>
              </th>
              {/* Хүний нэр жишигт 10pt. */}
              <td className="perf-cell--10">
                <EditableText
                  fieldKey="intro.director"
                  value={model.director}
                  onChange={scalar('director')}
                  disabled={p.disabled}
                  placeholder="Захирлын нэр"
                />
              </td>
              <th>
                <T k="intro.lbl.ceo">Chief executive officer:</T>
                <T k="intro.lbl.ceo.mn" as="small">(Гүйцэтгэх захирал)</T>
              </th>
              <td className="perf-cell--10">
                <EditableText
                  fieldKey="intro.ceo"
                  value={model.ceo}
                  onChange={scalar('ceo')}
                  disabled={p.disabled}
                  /* Паспорт нь шошгыг «Төслийн менежер» болгодог тул
                     placeholder ч түүнийг дагана (`PassportDocumentEditor`
                     `PASSPORT_TEXT`); тайланд өгөгдмөл хэвээр. */
                  placeholder={text.t('intro.ph.ceo', 'Гүйцэтгэх захирлын нэр')}
                />
              </td>
            </tr>
            <tr>
              <th>
                <T k="intro.lbl.discipline">Discipline:</T>
                <T k="intro.lbl.discipline.mn" as="small">(Ажлын хэсэг)</T>
              </th>
              {/* Жишигт энэ нь ПАДДИНГГҮЙ үүрлэсэн хүснэгт — 8 нүд нь
                  colSpan=3 талбайг ЯГ дүүргэдэг.  `perf-disc-cell` нь
                  хажуугийн зайг тэглэж тэр өргөнийг чөлөөлнө. */}
              <td colSpan={3} className="perf-disc-cell">
                {/* ⚠️ Жишиг баримт нь ЯГ 8 нүдтэй = 131.34mm.  Эзний шийдвэр
                    2026-09-02-оор паспортын салбарын жагсаалт 10 код хэвээр
                    үлдсэн (ЭЗ, ГТ хоёрыг хасаагүй) тул бүгдийг нь тэмдэглэсэн
                    төслийн мөр 8+2 болж хуваагдах эрсдэлтэй.
                    8 ба түүнээс цөөн үед CSS-ийн жишиг өргөнийг ХЭВЭЭР
                    үлдээнэ — хуучин тайлангууд бит-ижил хэвлэгдэнэ; зөвхөн
                    8-аас ОЛОН үед л нийт өргөнийг тэнцүү хуваана. */}
                <div
                  className="perf-discipline-cells"
                  style={
                    shownDisciplines.length > 8
                      ? {
                          gridTemplateColumns: `repeat(${shownDisciplines.length}, minmax(0, ${(
                            131.34 / shownDisciplines.length
                          ).toFixed(2)}mm))`,
                        }
                      : undefined
                  }
                >
                  {shownDisciplines.map((code) => {
                    const on = model.disciplines.includes(code);
                    const cls = [editable ? 'perf-disc-toggle' : '', on ? '' : 'perf-disc--off']
                      .filter(Boolean)
                      .join(' ');
                    return (
                      /* ⚠️ Гарын түлхүүрээр дарагдах ЁСТОЙ: төсөл үүсгэх
                         товч «дор хаяж нэг ажлын хэсэг» шаарддаг тул зөвхөн
                         хулганаар дардаг бол хулганагүй хэрэглэгч төсөл огт
                         үүсгэж чадахгүй болно. */
                      <span
                        key={code}
                        className={cls || undefined}
                        role={editable ? 'checkbox' : undefined}
                        aria-checked={editable ? on : undefined}
                        tabIndex={editable ? 0 : undefined}
                        onClick={editable ? () => toggleDiscipline(code) : undefined}
                        onKeyDown={
                          editable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleDiscipline(code);
                                }
                              }
                            : undefined
                        }
                        title={editable ? (on ? 'Хасах' : 'Нэмэх') : undefined}
                      >
                        {DISCIPLINE_LABEL[code] || code}
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Жишигт паспортын хүснэгт ба Бичиг баримтын хүснэгтийн ХООРОНД
            хажуугийн хүрээгүй, зөвхөн дээд/доод шугамтай цагаан зурвас. */}
        <div className="perf-intro__rule" />
      </div>

      {/* ---- Бичиг баримт: 1.1-ийн үргэлжлэл, дугааргүй хүснэгт ---- */}
      <table
        className="perf-table perf-table--intro"
        style={tableStyle(COL_DOCS)}
        data-a4-item={docsFlow ? undefined : true}
      >
        <Cols widths={COL_DOCS} />
        <thead>
          <tr data-a4-item={docsFlow ? true : undefined}>
            <th className="perf-cell--center">
              <T k="intro.docs.col.no">№</T>
            </th>
            <th>
              <T k="intro.docs.col.name">Documents</T>
              <br />
              <T k="intro.docs.col.name.mn" as="small">(Бичиг баримт)</T>
            </th>
            <th>
              <T k="intro.docs.col.docno">No.:</T>
              <br />
              <T k="intro.docs.col.docno.mn" as="small">(Дугаар)</T>
            </th>
            <th>
              <T k="intro.docs.col.date">Date:</T>
              <br />
              <T k="intro.docs.col.date.mn" as="small">(Он сар өдөр)</T>
            </th>
            <th>
              <T k="intro.docs.col.desc">Description:</T>
              <br />
              <T k="intro.docs.col.desc.mn" as="small">(Тайлбар)</T>
            </th>
            {editable && <th className="perf-rowbtn-cell" />}
          </tr>
        </thead>
        <tbody>
          {docs.map((d, i) => (
            <tr key={d.id} data-a4-item={docsFlow ? true : undefined}>
              <td className="perf-cell--center">{i + 1}</td>
              <td>
                <EditableText
                  fieldKey={`intro.doc.${d.id}.name`}
                  value={d.name}
                  onChange={
                    emit
                      ? (v) =>
                          emit({
                            documents: docs.map((r) => (r.id === d.id ? { ...r, name: v } : r)),
                          })
                      : undefined
                  }
                  disabled={p.disabled}
                  placeholder="Бичиг баримтын нэр"
                  multiline
                />
              </td>
              <td>
                <EditableText
                  fieldKey={`intro.doc.${d.id}.no`}
                  value={d.no}
                  onChange={
                    emit
                      ? (v) =>
                          emit({
                            documents: docs.map((r) => (r.id === d.id ? { ...r, no: v } : r)),
                          })
                      : undefined
                  }
                  disabled={p.disabled}
                  placeholder="-"
                />
              </td>
              <td>
                <EditableText
                  fieldKey={`intro.doc.${d.id}.date`}
                  value={toDottedDate(d.date)}
                  inputMask="date"
                  onChange={
                    emit
                      ? (v) =>
                          emit({
                            documents: docs.map((r) => (r.id === d.id ? { ...r, date: v } : r)),
                          })
                      : undefined
                  }
                  disabled={p.disabled}
                  placeholder="-"
                />
              </td>
              <td>
                <EditableText
                  fieldKey={`intro.doc.${d.id}.description`}
                  value={d.description}
                  onChange={
                    emit
                      ? (v) =>
                          emit({
                            documents: docs.map((r) =>
                              r.id === d.id ? { ...r, description: v } : r,
                            ),
                          })
                      : undefined
                  }
                  disabled={p.disabled}
                  placeholder="Тайлбар"
                  multiline
                />
              </td>
              {emit && (
                <RowButtons
                  onAdd={() => emit({ documents: insertAt(docs, i, blankDoc()) })}
                  onRemove={() => emit({ documents: docs.filter((r) => r.id !== d.id) })}
                />
              )}
            </tr>
          ))}
          {emit && docs.length === 0 && (
            <AddFirstRow cols={6} onAdd={() => emit({ documents: [blankDoc()] })} />
          )}
        </tbody>
      </table>

      {/* ================= 1.2 Scope of work ================= */}
      {/* `scopeFlow` үед бүлэг НЭГ нэгж байхаа болино — эс тэгвэл урт
          хүснэгт бүхэлдээ дараагийн хуудас руу үсэрч өмнөх хуудсыг
          хоосон үлдээнэ (`docsFlow`-той яг ижил дүрэм: тэмдэглэгээ
          үргэлж НЭГ л түвшинд). */}
      {/* ⚠️ `scopeFlow` үед тэмдэглэгээг АВАХ нь ЗӨВХӨН дэлгэцийн пагинаторт
          үйлчилнэ.  Хэвлэлд бүлгийг наадаг нь styles.ts-ийн
          «.perf-intro__group { break-inside: avoid }» тул тэр үед «--flow»
          модификаторыг мөн өгч хоёр гарцыг тэнцүүлнэ. */}
      <div
        className={scopeFlow ? 'perf-intro__group perf-intro__group--flow' : 'perf-intro__group'}
        data-a4-item={scopeFlow ? undefined : true}
      >
        <div
          className="perf-intro__sub"
          data-toc="s1.2"
          data-a4-item={scopeFlow ? true : undefined}
        >
          <T k="intro.h.12">1.2. Scope of work</T>{' '}
          <T k="intro.h.12.mn" as="em">(Хамрах хүрээ)</T>
        </div>

        <table className="perf-table perf-table--intro" style={tableStyle(scopeCols)}>
          <Cols widths={scopeCols} />
          <thead>
            <tr data-a4-item={scopeFlow ? true : undefined}>
              <th className="perf-cell--center">
                <T k="intro.scope.col.no">№</T>
              </th>
              {/* Жишигт товчлол нь ЯГ «Dic.» (Discl/Disc БИШ). */}
              <th className="perf-cell--center">
                <T k="intro.scope.col.dic">Dic.</T>
                <br />
                <T k="intro.scope.col.dic.mn" as="small">(А/хэсэг)</T>
              </th>
              <th>
                <T k="intro.scope.col.ident">Identification:</T>
                <br />
                <T k="intro.scope.col.ident.mn" as="small">(Тодорхойлолт)</T>
              </th>
              <th>
                <T k="intro.scope.col.leader">Team leader:</T>
                <br />
                <T k="intro.scope.col.leader.mn" as="small">(Хариуцсан ахлах)</T>
              </th>
              {hasSpecialist && (
                <th>
                  <T k="intro.scope.col.spec">Specialist:</T>
                  <br />
                  <T k="intro.scope.col.spec.mn" as="small">(Хариуцсан мэргэжилтэн)</T>
                </th>
              )}
              <th>
                <T k="intro.scope.col.file">File name:</T>
                <br />
                <T k="intro.scope.col.file.mn" as="small">(Файл хадгалах загвар нэр)</T>
              </th>
              {editable && <th className="perf-rowbtn-cell" />}
            </tr>
          </thead>
          <tbody>
            {scopeRows.map((s, i) => (
              <tr key={s.id} data-a4-item={scopeFlow ? true : undefined}>
                <td className="perf-cell--center perf-cell--10">{i + 1}</td>
                <td className="perf-cell--center perf-cell--10">
                  {/* Шошгыг гараар давхар бичиж болно — хадгалахдаа
                      `codeLabel` руу бичнэ, `code` нь машины талын түлхүүр
                      хэвээр үлдэнэ. */}
                  <EditableText
                    fieldKey={`intro.scope.${s.id}.code`}
                    value={s.codeLabel || DISCIPLINE_LABEL[s.code] || s.code}
                    onChange={
                      emit
                        ? (v) =>
                            emit({
                              scopeRows: scopeRows.map((r) =>
                                r.id === s.id ? { ...r, codeLabel: v } : r,
                              ),
                            })
                        : undefined
                    }
                    disabled={p.disabled}
                    placeholder="БА"
                  />
                </td>
                <td className="perf-cell--10">
                  <EditableText
                    fieldKey={`intro.scope.${s.id}.identification`}
                    value={s.identification}
                    onChange={
                      emit
                        ? (v) =>
                            emit({
                              scopeRows: scopeRows.map((r) =>
                                r.id === s.id ? { ...r, identification: v } : r,
                              ),
                            })
                        : undefined
                    }
                    disabled={p.disabled}
                    placeholder="Тодорхойлолт"
                    multiline
                  />
                </td>
                <td className="perf-cell--10">
                  <EditableText
                    fieldKey={`intro.scope.${s.id}.leader`}
                    value={s.leader}
                    onChange={
                      emit
                        ? (v) =>
                            emit({
                              scopeRows: scopeRows.map((r) =>
                                r.id === s.id ? { ...r, leader: v } : r,
                              ),
                            })
                        : undefined
                    }
                    disabled={p.disabled}
                    placeholder="Хариуцсан ахлах"
                  />
                </td>
                {hasSpecialist && (
                  <td className="perf-cell--10">
                    <EditableText
                      fieldKey={`intro.scope.${s.id}.specialist`}
                      value={s.specialist}
                      onChange={
                        emit
                          ? (v) =>
                              emit({
                                scopeRows: scopeRows.map((r) =>
                                  r.id === s.id ? { ...r, specialist: v } : r,
                                ),
                              })
                          : undefined
                      }
                      disabled={p.disabled}
                      placeholder="Хариуцсан мэргэжилтэн"
                    />
                  </td>
                )}
                <td>
                  {/* ⚠️ Өнгө хуваалт нь текстийг хэд хэдэн <span> болгодог
                      тул contentEditable дотор орвол бичих бүрт DOM дахин
                      бүтэж caret үсэрнэ (EditableText-ийн гол хязгаарлалт).
                      Тиймээс ЗАСВАРЛАХ горимд энгийн нэг өнгөт талбар,
                      зөвхөн `disabled` (хэвлэх / PDF) үед л жишиг docx-ийн
                      3 өнгөт хувилбарыг render хийнэ. */}
                  {emit ? (
                    <EditableText
                      className="perf-scope-table__file"
                      fieldKey={`intro.scope.${s.id}.fileName`}
                      value={s.fileName}
                      onChange={(v) =>
                        emit({
                          scopeRows: scopeRows.map((r) =>
                            r.id === s.id ? { ...r, fileName: v } : r,
                          ),
                        })
                      }
                      placeholder="240918_PROJECT_BA_A"
                    />
                  ) : (
                    <span className="perf-scope-table__file">{renderFileName(s.fileName)}</span>
                  )}
                </td>
                {emit && (
                  <RowButtons
                    onAdd={() => emit({ scopeRows: insertAt(scopeRows, i, blankScope()) })}
                    onRemove={() => emit({ scopeRows: scopeRows.filter((r) => r.id !== s.id) })}
                  />
                )}
              </tr>
            ))}
            {emit && scopeRows.length === 0 && (
              <AddFirstRow
                cols={scopeCols.length + 1}
                onAdd={() => emit({ scopeRows: [blankScope()] })}
              />
            )}
          </tbody>
        </table>
      </div>

      {/* ================= 1.3 Project Timeline ================= */}
      {/* ⚠️ Бүлэг БҮХЭЛДЭЭ нэг атом нэгж БАЙХГҮЙ (2026-08-25).  Урьд нь
          «perf-intro__group» дээр «data-a4-item» байсан тул гарчиг + файлын
          нэрийн хайрцаг + зэрэгцээ хоёр хүснэгт нийлээд ~91mm-ийн ганц
          хуваагдашгүй биет болж, 1.2-ын дараа хуудсанд 40% сул зай үлдсэн ч
          БҮТНЭЭРЭЭ дараагийн хуудас руу үсэрдэг байв.  Одоо ХОЁР нэгж:
            • «perf-intro__head-row» — гарчиг + файлын нэрийн хайрцаг (~30mm)
            • «perf-intro__two-up»   — зэрэгцээ хоёр хүснэгт (~50mm)
          Зэрэгцээ байдал хадгалагдана (two-up нь дотроо хуваагдахгүй), харин
          хоёул өмнөх хуудсанд амархан багтана.  Гарчиг өнчрөхөөс
          «break-after: avoid» хамгаална (styles.ts дахь .perf-intro__sub ба
          introStyles.ts дахь .perf-intro__head-row).
          «--flow» модификатор нь styles.ts-ийн «.perf-intro__group
          { break-inside: avoid }»-ыг цуцалж ХЭВЛЭЛИЙГ дэлгэцтэй тэнцүүлнэ —
          эс тэгвэл preview хуваагаад PDF нааж, хоёр нь зөрнө. */}
      <div className="perf-intro__group perf-intro__group--flow">
        {/* Жишигт «1.3 Project Timeline» гарчиг ЗҮҮН талд, «Зургийн файл
            хадгалах загвар» блок ТҮҮНТЭЙ НЭГ ТҮВШИНД БАРУУН талд сууна
            (1.2 хүснэгтийн доор, 1.3 хүснэгтүүдийн дээр).  Блок нь гарчгийн
            эгнээний ДОТОР байх ёстой — ингэснээр хоёр нь хэзээ ч салахгүй. */}
        <div className="perf-intro__head-row" data-a4-item>
          <div className="perf-intro__sub" data-toc="s1.3">
            <T k="intro.h.13">1.3. Project Timeline</T>{' '}
            <T k="intro.h.13.mn" as="em">(Төслийн хугацаа)</T>
          </div>

          {!model.hideFileNamingNote && (
            <div className="perf-fnote">
              <div className="perf-fnote__title">
                <EditableText
                  fieldKey="intro.note.title"
                  value={note.title}
                  onChange={
                    emit ? (v) => emit({ fileNamingNote: { ...note, title: v } }) : undefined
                  }
                  disabled={p.disabled}
                  placeholder="Зургийн файл хадгалах загвар"
                />
              </div>
              <div className="perf-fnote__pattern">
                {/* ⚠️ Жишигт энэ мөр PROJECT ID / DISCIPLINE / REVISION NO
                    гэж өнгөөр хуваагдсан.  Өнгө нь <span>-үүд үүсгэдэг тул
                    contentEditable дотор орвол бичих бүрт caret үсэрнэ —
                    иймд ЗАСВАРЛАХ горимд энгийн нэг өнгөт талбар, зөвхөн
                    `disabled` (хэвлэх / PDF) үед л өнгөт хувилбар. */}
                {emit ? (
                  <EditableText
                    fieldKey="intro.note.pattern"
                    value={note.pattern}
                    onChange={(v) => emit({ fileNamingNote: { ...note, pattern: v } })}
                    placeholder="YYMMDD_PROJECT ID_DISCIPLINE_REVISION NO*."
                  />
                ) : (
                  renderFileName(note.pattern)
                )}
              </div>
              {note.lines.map((line, i) => (
                <div
                  className={emit ? 'perf-fnote__line perf-fnote__line--edit' : 'perf-fnote__line'}
                  key={i}
                >
                  <EditableText
                    fieldKey={`intro.note.line.${i}`}
                    value={line}
                    onChange={
                      emit
                        ? (v) =>
                            emit({
                              fileNamingNote: {
                                ...note,
                                lines: note.lines.map((l, j) => (j === i ? v : l)),
                              },
                            })
                        : undefined
                    }
                    disabled={p.disabled}
                    placeholder="Тайлбар мөр"
                    multiline
                  />
                  {emit && (
                    <span>
                      <button
                        type="button"
                        className="perf-rowbtn"
                        title="Мөр нэмэх"
                        onClick={() =>
                          emit({ fileNamingNote: { ...note, lines: insertAt(note.lines, i, '') } })
                        }
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="perf-rowbtn"
                        title="Мөр устгах"
                        onClick={() =>
                          emit({
                            fileNamingNote: {
                              ...note,
                              lines: note.lines.filter((_, j) => j !== i),
                            },
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {emit && note.lines.length === 0 && (
                <button
                  type="button"
                  className="perf-rowbtn"
                  title="Мөр нэмэх"
                  onClick={() => emit({ fileNamingNote: { ...note, lines: [''] } })}
                >
                  +
                </button>
              )}
            </div>
          )}
        </div>

        {/* Зэрэгцээ хоёр хүснэгт — НЭГ нэгж.  Хуваавал зүүн/баруун хүснэгт
            өөр өөр хуудсанд унаж зэрэгцээ байдал алдагдана; өндөр нь ~50mm
            тул нэг нэгж байх нь ямар ч хуудсанд асуудалгүй. */}
        <div className="perf-intro__two-up" data-a4-item>
          {/* ---- зүүн: төслийн хугацаа (85.71mm) ---- */}
          <table className="perf-table perf-table--intro" style={tableStyle(COL_TIMELINE)}>
            <Cols widths={COL_TIMELINE} />
            <thead>
              <tr>
                <th className="perf-cell--center">
                  <T k="intro.tl.col.no">№</T>
                </th>
                <th>
                  <T k="intro.tl.col.label">Timeline:</T>
                  <br />
                  <T k="intro.tl.col.label.mn" as="small">(Хугацаа)</T>
                </th>
                <th>
                  <T k="intro.tl.col.date">Date:</T>
                  <br />
                  <T k="intro.tl.col.date.mn" as="small">(Он.сар.өдөр)</T>
                </th>
                {editable && <th className="perf-rowbtn-cell" />}
              </tr>
            </thead>
            <tbody>
              {timeline.map((t, i) => (
                <tr key={t.id}>
                  <td className="perf-cell--center">{i + 1}</td>
                  <td>
                    <EditableText
                      fieldKey={`intro.tl.${t.id}.labelEn`}
                      value={t.labelEn}
                      onChange={
                        emit
                          ? (v) =>
                              emit({
                                timeline: timeline.map((r) =>
                                  r.id === t.id ? { ...r, labelEn: v } : r,
                                ),
                              })
                          : undefined
                      }
                      disabled={p.disabled}
                      placeholder="Start"
                    />
                    {/* Жишигт цэг таслал ЗӨВХӨН «Extension» дээр байна
                        (Start / Finish дээр байхгүй).  EditableText-ийн
                        ГАДНА бичнэ — засварлахад саад болохгүй. */}
                    {/^extension$/i.test(t.labelEn.trim()) ? ':' : ''}{' '}
                    <small>
                      (
                      <EditableText
                        fieldKey={`intro.tl.${t.id}.labelMn`}
                        value={t.labelMn}
                        onChange={
                          emit
                            ? (v) =>
                                emit({
                                  timeline: timeline.map((r) =>
                                    r.id === t.id ? { ...r, labelMn: v } : r,
                                  ),
                                })
                            : undefined
                        }
                        disabled={p.disabled}
                        placeholder="Эхлэх"
                      />
                      )
                    </small>
                  </td>
                  <td>
                    <EditableText
                      fieldKey={`intro.tl.${t.id}.date`}
                      value={toDottedDate(t.date)}
                      inputMask="date"
                      onChange={
                        emit
                          ? (v) =>
                              emit({
                                timeline: timeline.map((r) =>
                                  r.id === t.id ? { ...r, date: v } : r,
                                ),
                              })
                          : undefined
                      }
                      disabled={p.disabled}
                      placeholder="-"
                    />
                  </td>
                  {emit && (
                    <RowButtons
                      onAdd={() => emit({ timeline: insertAt(timeline, i, blankTimeline()) })}
                      onRemove={() => emit({ timeline: timeline.filter((r) => r.id !== t.id) })}
                    />
                  )}
                </tr>
              ))}
              {emit && timeline.length === 0 && (
                <AddFirstRow cols={4} onAdd={() => emit({ timeline: [blankTimeline()] })} />
              )}
            </tbody>
          </table>

          {/* ---- баруун: уулзалтын хуваарь (78.15mm) ---- */}
          {(meetings.length > 0 || editable) && (
            <table className="perf-table perf-table--intro" style={tableStyle(COL_MEETING)}>
              <Cols widths={COL_MEETING} />
              <thead>
                <tr>
                  <th className="perf-cell--center">
                    <T k="intro.mt.col.no">№</T>
                  </th>
                  <th>
                    <T k="intro.mt.col.label">Meeting schedule</T>
                    <br />
                    <T k="intro.mt.col.label.mn" as="small">(Уулзалтын хуваарь)</T>
                  </th>
                  <th>
                    <T k="intro.mt.col.date">Date:</T>
                    <br />
                    <T k="intro.mt.col.date.mn" as="small">(Он.сар.өдөр)</T>
                  </th>
                  {editable && <th className="perf-rowbtn-cell" />}
                </tr>
              </thead>
              <tbody>
                {meetings.map((m, i) => (
                  <tr key={m.id}>
                    <td className="perf-cell--center">{i + 1}</td>
                    {/* 30% / 50% / 100% — жишигт төвлөрсөн. */}
                    <td className="perf-cell--center">
                      <EditableText
                        fieldKey={`intro.mt.${m.id}.label`}
                        value={m.label}
                        onChange={
                          emit
                            ? (v) =>
                                emit({
                                  meetings: meetings.map((r) =>
                                    r.id === m.id ? { ...r, label: v } : r,
                                  ),
                                })
                            : undefined
                        }
                        disabled={p.disabled}
                        placeholder="30%"
                      />
                    </td>
                    <td>
                      <EditableText
                        fieldKey={`intro.mt.${m.id}.date`}
                        value={toDottedDate(m.date)}
                        inputMask="date"
                        onChange={
                          emit
                            ? (v) =>
                                emit({
                                  meetings: meetings.map((r) =>
                                    r.id === m.id ? { ...r, date: v } : r,
                                  ),
                                })
                            : undefined
                        }
                        disabled={p.disabled}
                        placeholder="-"
                      />
                    </td>
                    {emit && (
                      <RowButtons
                        onAdd={() => emit({ meetings: insertAt(meetings, i, blankMeeting()) })}
                        onRemove={() => emit({ meetings: meetings.filter((r) => r.id !== m.id) })}
                      />
                    )}
                  </tr>
                ))}
                {emit && meetings.length === 0 && (
                  <AddFirstRow cols={4} onAdd={() => emit({ meetings: [blankMeeting()] })} />
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <PageFooter />
    </div>
  );
}
