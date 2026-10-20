/* =============================================================
 * «PROJECT DESCRIPTION» — БАРИМТЫН ХЭЛБЭРЭЭР бөглөх засварлагч.
 * -------------------------------------------------------------
 * Эзний хүсэлт 2026-09-02: «шинэ төсөл нэмэх үед яг скан хийсэн
 * зураг шиг хүснэгт дотор нь шууд бөглөдөг болгох».
 *
 * ⚠️ ЭНД ХҮСНЭГТ ДАХИН ЗУРАГДААГҮЙ.  Гүйцэтгэлийн тайлангийн §1
 * блокийг зурдаг `ProjectIntroPage`-ийг ЯГ ТЭР ЧИГЭЭР нь дахин
 * ашиглаж байна — 1.1 / Бичиг баримт / 1.2 / 1.3 хүснэгт, хүрээ,
 * өнгө, `EditableText`-ийн байрлалд засварлах бүхэн тэндээс ирнэ.
 * Хоёр дахь хувилбар бичвэл маягт ба хэвлэмэл баримт хоёр
 * тайлбаргүйгээр зөрнө.
 *
 * Апп дотор тайлангийн баримтыг суулгах хэв маяг нь аль хэдийн
 * бий: `TemplatePreview.tsx` (загварын урьдчилан харах) ба
 * `PerformanceReportPreview.tsx`.  Тэдэнтэй ижил: нэг <style>
 * шошго + `.perf-shell` + A4-ийн хэмжээг цуцлах override.
 *
 * ⚠️ БҮХ талбар ЖИНХЭНЭ state-тэй холбогдоно (түгжээтэй нүд
 * БАЙХГҮЙ) — учир нь энэ нь ҮҮСГЭХ шидтэнд ажилладаг бөгөөд тэнд
 * захиалагч, байршил, төслийн менежер бүгд орон нутгийн state.
 * Байгаа төсөл дээр `location` нь `projects`-д амьдардаг тул түгжинэ
 * (`passportDoc.ts` `LOCKED_FIELDS`); `clientName` нь 2026-09-28-аас
 * паспортын Хадгалахаар `project_clients`-д бичигдэнэ.
 * ============================================================= */

import { useLayoutEffect, useRef } from 'react';

import { PERFORMANCE_REPORT_STYLES } from '@/features/performance-reports/components/styles';
/* ⚠️ Баримт нь ДӨРВӨН стилийн модулиас бүрдэнэ.  Зөвхөн үндсэнийг нь өгвөл
 * баримт «бүтэн» харагдаад, үнэндээ 1.3-ын файлын нэрийн хайрцаг задарч,
 * салбарын ■ мөр ба хүснэгтийн баганы өргөн зөрнө (E2E-ээр хэмжсэн).
 * Хэвлэлийн хуудас ЯГ эдгээрийг залгадаг — жагсаалтыг тэндээс хуулсан. */
import { INTRO_STYLES } from '@/features/performance-reports/components/introStyles';
import { EDITABLE_STYLES } from '@/features/performance-reports/components/EditableText';
import {
  REPORT_TEXT_STYLES,
  ReportTextContext,
  type ReportTextApi,
} from '@/features/performance-reports/lib/reportText';
import {
  ProjectIntroPage,
  type ScalarKey,
} from '@/features/performance-reports/components/ProjectIntroPage';
import { ReportBrandContext } from '@/features/performance-reports/components/TableOfContents';
import {
  DEFAULT_FILE_NAMING_NOTE,
  type IntroAuto,
  type IntroModel,
  type IntroOverride,
} from '@/features/performance-reports/types/introOverride';

/** Баримт дээр харагдах, засагдах БҮХ утга.
 *
 *  Түлхүүрүүд нь `IntroAuto`-гийнхтэй ЯГ ижил нэртэй — ингэснээр
 *  `ProjectIntroPage`-ийн ялгаварласан патчийг хөрвүүлэлгүйгээр шууд
 *  хэрэглэнэ (`onChange(patch)` → `setDraft({...draft, ...patch})`). */
export type PassportDocDraft = Pick<
  IntroAuto,
  | 'projectTitle'
  | 'clientName'
  | 'drawingNo'
  | 'scope'
  | 'location'
  | 'director'
  | 'ceo'
  | 'disciplines'
  | 'documents'
  | 'scopeRows'
  | 'timeline'
  | 'meetings'
>;

export function emptyPassportDocDraft(): PassportDocDraft {
  return {
    projectTitle: '',
    clientName: '',
    drawingNo: '',
    scope: '',
    location: '',
    director: '',
    ceo: '',
    disciplines: [],
    documents: [],
    scopeRows: [],
    timeline: [],
    meetings: [],
  };
}

/* ---------------------------------------------------------------
 * НЭГ A4-Д БАГТААХ (fit-to-page)
 * ---------------------------------------------------------------
 * Эзний шаардлага 2026-09-07: «хүснэгт нэмэхэд цаас доошоо сунах биш,
 * агуулга ШАХАГДАЖ нэг A4-д багтах».  Тиймээс баримт ЖИНХЭНЭ A4 болов
 * (`min-height: 297mm`) бөгөөд халих үед `--pd-k` масштабаар тигийн
 * хэмжээ ба босоо зайг жижигрүүлнэ.
 *
 * ⚠️ Яагаад `transform: scale()` БИШ вэ: хүснэгтүүдийн баганы өргөн mm-ээр
 * ТОГТМОЛ (COL_PASSPORT…) тул scale нь өргөнийг ч агшааж баримтыг хуудасны
 * дунд нарийхан тууз болгоно.  Зөвхөн тигийн хэмжээ + босоо зайг шахвал
 * хүснэгт 170.24mm өргөнөө хадгалж, ЗӨВХӨН өндөр нь буурна — эзний
 * «зайг нь fill хийгээд» гэдэг яг энэ. */
/* Паспортын гарчиг тайлангийн §1-ээс ӨӨР (эзний хүсэлт 2026-09-28):
 * «1. Төслийн танилцуулга / Project description» → «1. Төслийн мэдээлэл /
 * Project Information».  `ProjectIntroPage`-ийн өгөгдмөлийг ХӨНДӨХГҮЙ —
 * гүйцэтгэлийн тайлан, түүний агуулга (TOC) хуучин гарчгаа хадгална.
 * `set: null` = шошго засагдахгүй (паспортад `textOverrides` хадгалах
 * газар байхгүй).
 *
 * «Chief executive officer / Гүйцэтгэх захирал» → «Client Project manager /
 * Төслийн менежер» (эзний хүсэлт 2026-09-28): тэр нүд нь `client_contacts[0]`
 * буюу захиалагчийн төслийн менежментийн холбогдох хүн (`passportDoc.ts`
 * `ceoDisplay`) — гүйцэтгэх захирал БИШ.  Талбарын түлхүүр `ceo` хэвээр. */
const PASSPORT_TEXT: Readonly<Record<string, string>> = {
  'intro.h.section': '1. Төслийн мэдээлэл',
  'intro.h.section.en': 'Project Information',
  'intro.lbl.ceo': 'Client Project manager:',
  'intro.lbl.ceo.mn': '(Төслийн менежер)',
  'intro.ph.ceo': 'Төслийн менежерийн нэр',
};
const PASSPORT_TEXT_API: ReportTextApi = {
  t: (key, fallback) => PASSPORT_TEXT[key] ?? fallback,
  set: null,
};

const PX_PER_MM = 96 / 25.4;
/** Хуудасны бүтэн өндөр (A4). `.pd-doc-shell .perf-page`-тэй ИЖИЛ байх ёстой. */
const PAGE_H_PX = 297 * PX_PER_MM;
/** Хамгийн жижиг масштаб — үүнээс доош уншигдахаа болино, тиймээс цаас сунана. */
const MIN_K = 0.55;

export function PassportDocumentEditor({
  value,
  onChange,
  readOnly = false,
  lockedFields,
}: {
  value: PassportDocDraft;
  /** `ProjectIntroPage`-ийн ялгаварласан патч — түлхүүр нь draft-тай ижил. */
  onChange: (patch: Partial<IntroOverride>) => void;
  readOnly?: boolean;
  /** Байгаа төсөл дээр `location` — толгойн тайлбарыг үз. */
  lockedFields?: readonly ScalarKey[];
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  /* Сүүлд тогтсон масштаб.  Дараагийн хэмжилтийг ҮҮНЭЭС эхлүүлнэ — эс бөгөөс
   * товчлуур дарах болгонд 1-ээс эхлээд бүх алхмыг дахин туулж, том баримт
   * дээр бичих бүрт хэдэн арван layout албадана. */
  const kRef = useRef(1);

  /* Мөр нэмэх/хасах, урт текст бичих бүрт дахин тохируулна.  State БИЧИХГҮЙ
   * (зөвхөн CSS хувьсагч) тул дахин render дуудахгүй — value шинэ объект
   * ирэх болгонд ажиллах нь аюулгүй. */
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const page = shell?.querySelector<HTMLElement>('.perf-page');
    if (!shell || !page) return;

    /** min-height-ийг түр авч БОДИТ агуулгын өндрийг хэмжинэ. */
    const measure = () => {
      page.style.minHeight = '0';
      const h = page.offsetHeight;
      page.style.minHeight = '';
      return h;
    };
    const setK = (k: number) => {
      kRef.current = k;
      shell.style.setProperty('--pd-k', String(k));
    };

    setK(kRef.current);

    /* 1) Халиж байвал шахна.  Өндөр нь масштабтай ЯГ шугаман биш (хүрээ,
     *    padding тогтмол) тул харьцаагаар алхаад бага зэрэг доош түлхэнэ;
     *    нэг алхамд 15%-иас илүү унахгүй. */
    for (let i = 0; i < 12; i += 1) {
      const h = measure();
      if (h <= PAGE_H_PX) break;
      const next = Math.max(MIN_K, kRef.current * Math.max(0.85, PAGE_H_PX / h) - 0.01);
      if (next >= kRef.current) break;
      setK(next);
    }

    /* 2) Мөр устгасны дараа буцаж томорно — эс бөгөөс баримт нэг л удаа
     *    жижгэрээд хэзээ ч сэргэхгүй. */
    for (let i = 0; i < 12 && kRef.current < 1; i += 1) {
      const prev = kRef.current;
      setK(Math.min(1, prev * 1.06));
      if (measure() > PAGE_H_PX) {
        setK(prev);
        break;
      }
    }
  });

  const model: IntroModel = {
    ...value,
    /* «Doc. No.» мөр 2026-09-28-нд хасагдсан — паспортад ийм нүд байхгүй. */
    docNo: '',
    fileNamingNote: DEFAULT_FILE_NAMING_NOTE,
    /* ⚠️ ЗААВАЛ нуух.  Энэ хайрцаг нь `IntroOverride.fileNamingNote`-д
     * бичдэг бөгөөд паспортад тэр талбарын БАГАНА байхгүй (`PassportPayload`-д
     * ч алга).  Засварлагдах хэлбэрээр үзүүлбэл `+`/`×` товч нь юу ч
     * хийхгүй, бичсэн текст нь `EditableText`-ийн фокус-хамгаалалтаас болж
     * дэлгэц дээр үлдэж «хадгалагдсан» мэт харагдана. */
    hideFileNamingNote: true,
  };

  return (
    /* Лого / тамга нь ТАЙЛАНГИЙН зүйл — паспортын маягтад байхгүй. */
    <ReportBrandContext.Provider value={{ logoUrl: null, clientLogoUrl: null, stampUrl: null }}>
      <div className="pd-doc-host" ref={shellRef}>
        <style
          dangerouslySetInnerHTML={{
            __html:
              PERFORMANCE_REPORT_STYLES +
              INTRO_STYLES +
              EDITABLE_STYLES +
              REPORT_TEXT_STYLES +
              PD_DOC_OVERRIDES,
          }}
        />
        <div className="perf-shell pd-doc-shell">
          <ReportTextContext.Provider value={PASSPORT_TEXT_API}>
            <ProjectIntroPage
              model={model}
              onChange={readOnly ? undefined : onChange}
              disabled={readOnly}
              /* Шидтэнд бүх мөр `specialist: ''`-ээс эхэлдэг тул тайлангийн
                 «утга байвал л үзүүл» дүрэм энэ баганыг ХЭЗЭЭ Ч гаргахгүй —
                 скан дээрх 2 дахь нэрийг оруулах газар байхгүй болно. */
              alwaysShowSpecialist
              lockedFields={lockedFields}
              /* Толгойн зурвасыг CSS-ээр нуусан тул эдгээр нь хэрэглэгдэхгүй,
                 гэхдээ prop нь заавал. */
              reportNo={0}
              reportDate=""
              drawingNo={value.drawingNo || null}
            />
          </ReportTextContext.Provider>
        </div>
      </div>
    </ReportBrandContext.Provider>
  );
}

/* ⚠️ ДООРХ ТЕМПЛЕЙТ ЛИТЕРАЛ ДОТОР BACKTICK БҮҮ БИЧ (styles.ts-ийн адил).
 *
 * `.perf-page` нь A4-ийн хэмжээтэй тул диалог дотор багтахгүй — TemplatePreview
 * ба PerformanceReportPreview-ийн ижил override-ыг хэрэглэнэ.  Диалогийн
 * өргөнөөс давсан үед хэвтээ гүйлгэнэ (хүснэгтийн харьцаа хадгалагдана). */
const PD_DOC_OVERRIDES = `
.pd-doc-host {
  background: #e9eaee;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.pd-doc-shell { background: transparent; }
/* Хар-хөх толгойн нүд (#0F243E, цагаан бичвэр) ХЭВЛЭЛД ч үлдэнэ.  Үгүй бол
   Chrome-ийн өгөгдмөл «Background graphics» унтраалттай үед дэвсгэр алга
   болж, цагаан бичвэр саарал болж цайрдаг байв (2026-09-28, эзний скрин).
   ЗХ / RFI-CR / үнийн саналын хэвлэлтэй ижил дүрэм. */
.pd-doc-shell,
.pd-doc-shell * {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pd-doc-shell .perf-page {
  width: 210mm;
  max-width: none;
  /* ЖИНХЭНЭ A4: доод талд нь цагаан зай харагдана, агуулга халих үед
     JS-ийн «--pd-k» масштаб түүнийг эргүүлж 297mm-д багтаана. */
  min-height: 297mm;
  height: auto;
  margin: 0 auto;
  /* ⚠️ ХАЖУУГИЙН 19.05mm нь ХЭВЛЭЛИЙНХТЭЙ ижил (styles.ts-ийн @media print
     дэх «.perf-page { padding-left/right: 19.05mm }»).  Өөр утга өгвөл
     170.24mm өргөнтэй хүснэгтүүд хуудсандаа голлохгүй, дэлгэц дээрх
     харагдац хэвлэсэн баримттай зөрнө. */
  padding: 8mm 19.05mm 10mm;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0,0,0,0.10);
  page-break-after: auto;
  break-after: auto;
}
/* ==============================================================
 * ЭХ WORD БАРИМТЫН ТИГ + ШАХАЛТ  (зөвхөн «.pd-doc-shell» дотор)
 * --------------------------------------------------------------
 * Эх .doc файлын жишиг: ТОЛГОЙ нь ТОМ ҮСГЭЭР Arial 10, жижиг
 * тайлбар (монгол хаалт) Arial 8, хүснэгтийн мөр ЧАНГА — Word-ийн
 * нүдний зай нь 0.05cm бөгөөд мөрийн өндөр 1.0 тул нэг мөр ≈ 5mm.
 * Апп дээр styles.ts нь дэлгэцийн тайланд зориулж «padding: 5px 8px»
 * + «line-height: 1.5» өгдөг байсан — тэр нь 8 мөрт хүснэгтийг 92.6mm
 * болгож, бүхэл баримтыг 346.7mm (A4-ээс 50mm илүү) хүргэж байв.
 *
 * ⚠️ ЗӨВХӨН ЭНД дарж бичнэ.  styles.ts / introStyles.ts-д хүрвэл
 * АЛЬ ХЭДИЙН ГАРГАСАН гүйцэтгэлийн тайлангуудын хуудас хуваалт бүхэлдээ
 * ухарна (тэдгээрийн §1 нь ЯГ ЭНЭ бүрэлдэхүүнийг хэрэглэдэг).  Тиймээс
 * маягт ба тайлан хоёрын тиг ЭНЭ ӨДРӨӨС ХОЙШ ЗӨРНӨ — зориудаар.
 *
 * «--pd-k» нь компонентын fit-to-page давталтаас ирнэ (1 = шахаагүй).
 * ============================================================== */
.pd-doc-host { --pd-k: 1; }

/* ---- мөрийн өндөр: Word-ийн 1.0-1.15 ---- */
.pd-doc-shell,
.pd-doc-shell .perf-page { line-height: 1.15; }

/* ---- хүснэгтийн нүд: зай багатай, босоо голлосон ---- */
.pd-doc-shell .perf-table th,
.pd-doc-shell .perf-table td {
  padding: 1px 5px;
  line-height: 1.15;
  vertical-align: middle;
}
.pd-doc-shell .perf-table { font-size: calc(9pt * var(--pd-k)); margin-bottom: calc(1.6mm * var(--pd-k)); }
.pd-doc-shell .perf-table--intro { margin-bottom: calc(1.6mm * var(--pd-k)); }

/* ---- ТОЛГОЙ: ТОМ ҮСГЭЭР, Arial 10 ---- */
.pd-doc-shell .perf-table thead th,
.pd-doc-shell .perf-table--passport th {
  font-size: calc(10pt * var(--pd-k));
  text-transform: uppercase;
}
/* Монгол хаалттай тайлбар нь ЖИЖИГ текст: 8pt, том үсэггүй, налуу. */
.pd-doc-shell .perf-table th small,
.pd-doc-shell .perf-table td small {
  font-size: calc(8pt * var(--pd-k));
  text-transform: none;
  line-height: 1.1;
}
/* Утгын нүд: жишиг баримтын 10pt хэвээр, зөвхөн масштабтай. */
.pd-doc-shell .perf-cell--10 { font-size: calc(10pt * var(--pd-k)); }
.pd-doc-shell .perf-discipline-cells { font-size: calc(9pt * var(--pd-k)); }
.pd-doc-shell .perf-scope-table__file { font-size: calc(9pt * var(--pd-k)); }

/* ---- гарчгууд: ТОМ ҮСЭГ 10pt, зай хамгийн бага ---- */
.pd-doc-shell .perf-intro__section-num {
  font-size: calc(10pt * var(--pd-k));
  text-transform: uppercase;
  margin: 0 0 calc(1.5mm * var(--pd-k));
}
.pd-doc-shell .perf-intro__section-num em { font-size: calc(8pt * var(--pd-k)); text-transform: none; }
.pd-doc-shell .perf-intro__sub {
  font-size: calc(10pt * var(--pd-k));
  text-transform: uppercase;
  margin: calc(2mm * var(--pd-k)) 0 calc(1mm * var(--pd-k));
}
.pd-doc-shell .perf-intro__sub em { font-size: calc(8pt * var(--pd-k)); text-transform: none; }
.pd-doc-shell .perf-intro__head-row { margin: calc(2mm * var(--pd-k)) 0 calc(1mm * var(--pd-k)); }
/* Паспорт ба «Бичиг баримт» хүснэгтийн хоорондох цагаан зурвас — зөвхөн
   зай; дээд/доод шугамыг паспорт дээр хассан (эзэн 2026-09-28: хүснэгт
   хооронд шугам хэрэггүй).  Гүйцэтгэлийн тайлан (introStyles.ts) хэвээр. */
.pd-doc-shell .perf-intro__rule { height: calc(1.5mm * var(--pd-k)); margin-bottom: calc(1mm * var(--pd-k)); border: 0; }
/* Хоосон талбарын санамж («Хариуцсан мэргэжилтэн» гэх мэт) нарийн баганад
   2 мөр болж мөрийг өндөрсгөдөг — санамжийг жижиг үсгээр. */
/* Санамж нь ХЭМЖЭЭ эзлэх ёсгүй: нарийн баганад 2 мөр болж мөрийг
   өндөрсгөж, дүүрсэн мөр ба хоосон мөр өөр өндөртэй болгодог.  Тайрахыг
   ХООСОН талбар дээр нь тавина (--empty класс нь текст орсон даруйд
   алга болдог тул хэрэглэгчийн бичсэн юмыг хэзээ ч нуухгүй). */
.pd-doc-shell .perf-edit--empty {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.pd-doc-shell .perf-edit--empty::before { font-size: calc(7.5pt * var(--pd-k)); }

/* «Хуудас N» хөл ба хуудас таслах шинжүүд нь ТАЙЛАНГИЙНХ — маягтад утгагүй. */
.pd-doc-shell .perf-page__footer { display: none !important; }
.pd-doc-shell .perf-page { break-before: auto; page-break-before: auto; }
/* «Гүйцэтгэлийн тайлан №.. / огноо» зурвас нь ТАЙЛАНГИЙНХ — паспортын
   маягтад утгагүй тул нуув (утга нь ч дамжуулагдаагүй). */
.pd-doc-shell .perf-page__header { display: none !important; }
/* Засварлаж буй нүд ил харагдах — хоосон нүд «энд бич» гэдэг нь мэдэгдэхүйц
   байх ёстой, эс бөгөөс хэрэглэгч хаана дарахаа мэдэхгүй. */
.pd-doc-shell [contenteditable="true"] {
  outline: 1px dashed rgba(15,36,62,0.25);
  outline-offset: 1px;
  min-width: 2ch;
  border-radius: 2px;
}
.pd-doc-shell [contenteditable="true"]:hover { background: rgba(15,36,62,0.04); }
.pd-doc-shell [contenteditable="true"]:focus {
  outline: 2px solid rgba(15,36,62,0.55);
  background: rgba(15,36,62,0.06);
}
@media print {
  /* ⚠️ Аппын хэвлэлийн тусгаарлалтыг СЭРГЭЭНЭ.  styles.ts нь «body, body *
     { visibility: visible !important }» зарладаг — тэр нь бие даасан
     хэвлэлийн МАРШРУТАД зориулагдсан.  Энэ баримт нь /app/projects дотор
     Layout-той хамт амьдардаг тул тэрийг үлдээвэл цонх нээлттэй байхад
     Ctrl+P дарахад бүх sidebar, header, ард байгаа жагсаалт хэвлэгдэнэ. */
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  /* ⚠️ margin: 0 — БАРИМТ ӨӨРӨӨ 210×297mm бөгөөд өөрийн 8/19.05/10mm
     зайг агуулдаг.  Энд @page-ийн зай өгвөл тэр нь баримтын дээр
     НЭМЭГДЭЖ 297mm нь хуудсанд багтахаа болиод хоёр дахь хуудас руу
     нэг мөр унана — fit-to-page давталтын бүх ажлыг үрэгдүүлнэ. */
  @page { size: A4; margin: 0; }
  /* index.css-ийн «.print-area { padding: 1cm }» нь энгийн хүснэгтийн
     хэвлэлд зориулагдсан — энд баримт өөрөө хуудасны зайгаа агуулдаг тул
     тэр 1cm нь 297mm-ийг халиулж хоёр дахь хуудас үүсгэнэ. */
  .pd-doc-print.print-area { padding: 0 !important; }
  /* overflow: visible — дэлгэцийн «overflow-x: auto» хэвлэлд хэвтээ скроллын
     зураас болж баримтын доор хэвлэгддэг байв. */
  .pd-doc-host { padding: 0; background: #fff; border-radius: 0; overflow: visible !important; }
  .pd-doc-shell .perf-page { box-shadow: none; margin: 0; }
  /* 297mm-ийн min-height нь цаасны өндөртэй ЯГ тэнцүү тул дугуйралтаар хоосон
     2-р хуудас гаргаж болно.  Агуулга аль хэдийн «--pd-k»-оор 297mm-д
     шахагдсан тул хэвлэлд өндөр нь агуулгаараа л байна. */
  .pd-doc-shell .perf-page { min-height: 0 !important; }
}
`;
