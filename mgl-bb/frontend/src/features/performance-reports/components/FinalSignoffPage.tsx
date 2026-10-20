import { useContext } from 'react';
import {
  PageHeader,
  PageFooter,
  ReportBrandContext,
} from '@/features/performance-reports/components/TableOfContents';
import { T } from '@/features/performance-reports/lib/reportText';
import { HandSignature } from '@/shared/components/HandSignature';
import { SIGN_IMG_MM } from '@/features/performance-reports/components/finalSignoffStyles';

/* =============================================================
 * Тайлангийн хамгийн сүүлийн хуудас — албан ёсны баталгаажуулалт.
 * -------------------------------------------------------------
 * Эхний догол мөрөнд төслийн НИЙТ явц (%)-ийг бичиж зургийг
 * захиалагч хүлээж авсныг тэмдэглэнэ; цаашид өөрчлөлт хийхгүйг
 * заасан 2 дахь догол мөр. Доор нь 2 баганат гарын үсгийн талбар:
 * зүүн — Гүйцэтгэгч (Submitted by), баруун — Захиалагч (Reviewed &
 * Approved by).
 *
 * ---------------------------------------------------------------
 * ⚠️ ЗОХИОМЖ — CSS GRID, МӨР-БҮРЭЭР (2026-08-25)
 * ---------------------------------------------------------------
 * Өмнө нь «.perf-final__sign» нь «display:flex» байсан бөгөөд багана бүр
 * өөрийн агуулгаа дараалан өрдөг байв.  Ийм үед баруун гарчиг («Хянаж,
 * баталгаажуулсан (Reviewed and Approved by)») 2 мөр болмогц түүний
 * ДООРХ БҮХ мөр нэг мөрийн өндрөөр доошоо гулсаж, хоёр багана шатлан
 * харагддаг байв (хэрэглэгчийн гомдол).
 *
 * Одоо «grid-template-columns: 1fr 1fr» бөгөөд JSX нь багана-бүрээр БИШ,
 * МӨР-БҮРЭЭР өрөгдөнө: гарчиг/гарчиг · тамга/тамга ·
 * байгууллага/байгууллага · төлөөлөгч/төлөөлөгч · огноо/огноо.  Grid-ийн
 * мөр нь хамгийн ӨНДӨР нүдээрээ тэгширдэг тул нэг тал 2 мөр болсон ч
 * нөгөө талын дараагийн мөр огт хөдлөхгүй.
 *
 * ⚠️ Тиймээс мөр бүрийн туслах («ColTitle», «StampCell», «ValueField») нь
 * НЭГ нүд буцаана — тэдгээрийг зүүн/баруун гэж ХОСООРОО дуудна.  Багана
 * бүрийг НЭГ элемент дотор боовол grid-ийн тэгшилгээ алдагдана.
 *
 * ---------------------------------------------------------------
 * ТҮЛХҮҮР (signoff.*)
 * ---------------------------------------------------------------
 * Энэ хуудас нь БЛОК БИШ — «PerformanceReportPreview» /
 * «PerformanceReportPrintPage» нь түүнийг баримтын түвшний
 * «ReportTextContext» (docTextApi) дотор render хийдэг тул түлхүүрүүд
 * танилцуулгын блокийн нэрийн зайд хадгалагдана.  Иймд signoff.
 * угтвар ЗААВАЛ — intro.*-той мөргөлдөх ёсгүй.
 *
 * ⚠️ Хоёр багана ижил шошготой («Гарын үсэг:», «Огноо:»).  Нэг
 * түлхүүрийг ХУВААЛЦВАЛ DOM-д «data-editkey» давхардаж, баруун
 * баганад бичихэд «restoreCaret()» курсорыг зүүн багана руу үсэргэнэ.
 * Тиймээс багана бүр өөрийн угтвартай: signoff.exec.* / signoff.client.*.
 *
 * Шошго (*.lbl.*) ба УТГА (*.val.*) хоёр ТУСДАА түлхүүртэй:
 *   signoff.exec.lbl.org  · signoff.exec.val.org   (байгууллагын нэр)
 *   signoff.exec.lbl.rep  · signoff.exec.val.rep   (төлөөлөгчийн нэр, албан тушаал)
 *   signoff.exec.lbl.date · signoff.exec.val.date  (огноо)
 *   signoff.client.* — мөн адил.
 * ============================================================= */

/** Түлхүүрийн угтвар — багана бүр ӨӨРИЙН орон зайтай (дээрх ⚠️-г үз). */
const KP_EXEC = 'signoff.exec';
const KP_CLIENT = 'signoff.client';

export interface FinalSignoffPageProps {
  reportNo: number;
  reportDocNo: string | null;
  reportDate: string;
  /** Project-wide progress % (dashboard headline) injected into the
   *  declaratory paragraph ("…<X>%-ийн гүйцэтгэлд хүрснийг…"). */
  overallProgress: number;
  /** Захиалагчийн байгууллагын нэр — «1.1 Ерөнхий мэдээлэл»-ийн утга.
   *  Баруун баганын байгууллагын нэрний АНХДАГЧ утга болно (хэрэглэгч
   *  дээр нь бичвэл override нь давамгайлна). */
  clientName: string;
  /** «Боловсруулсан ажилтан»-ы ХҮЧИН ТӨГӨЛДӨР нэр (`resolveSignerName`):
   *  хэрэглэгчийн бичсэн утга, эс бөгөөс тайланг үүсгэсэн хүний нэр.
   *  Зүүн баганын «Төлөөлөгчийн нэр, албан тушаал»-ын анхдагч утга. */
  signerName: string;
  /** Гүйцэтгэгч талын ГАРЫН ҮСГИЙН зураг (БҮТЭН URL эсвэл null).
   *  Тамга энд БАЙХГҮЙ — тэр нь байгууллагын тохиргоо тул
   *  `ReportBrandContext.stampUrl`-ээс уншина (доорхыг үз). */
  execSignatureUrl: string | null;
}

export function FinalSignoffPage({
  reportNo,
  reportDocNo,
  reportDate,
  overallProgress,
  clientName,
  signerName,
  execSignatureUrl,
}: FinalSignoffPageProps) {
  /* КОМПАНИЙН тамга — гарын үсэг зурсан хүнээс ХАМААРАХГҮЙ.  Логотой
   * яг ижил замаар (`/api/settings/branding`) ирдэг тул preview ба
   * PDF хоёр нэг эх сурвалжтай.  Тохируулаагүй бол зүгээр л хоосон
   * зай үлдэнэ — гараар тамга дарах боломж хэвээр. */
  const { stampUrl: execStampUrl } = useContext(ReportBrandContext);
  const pct = Math.round(Math.max(0, Math.min(100, Number(overallProgress) || 0)));
  const year = (reportDate || '').slice(0, 4) || String(new Date().getFullYear());
  /** Огнооны АНХДАГЧ бичвэр — хэрэглэгч бүтнээр нь дарж бичиж болно. */
  const dateDefault = year + ' оны ____ сарын ____ өдөр';
  return (
    <div className="perf-page" data-toc="final-signoff">
      <PageHeader reportNo={reportNo} reportDocNo={reportDocNo} reportDate={reportDate} />

      <div className="perf-intro__section-num" data-a4-item>
        <T k="signoff.h.title">Баталгаажуулалт</T>
      </div>

      {/* Догол мөр бүр бие даасан нэгж — хуудасны заагт таарвал бүтнээрээ
          дараагийн хуудас руу шилжинэ. */}
      <p className="perf-final__text" data-a4-item>
        <T k="signoff.txt.p1a">Энэхүү тайлангаар төслийн ажлын зургийн боловсруулалт</T>{' '}
        <strong className="perf-final__pct">{pct}%</strong>
        <T k="signoff.txt.p1b">
          -ийн гүйцэтгэлд хүрснийг албан ёсоор баталгаажуулж байна. Захиалагч тал холбогдох Google
          Drive хавтсанд хуваалцсан ажлын зургуудыг хянан танилцаж, бүрэн зөвшөөрсөн болно.
        </T>
      </p>
      <p className="perf-final__text" data-a4-item>
        <T k="signoff.txt.p2">
          Захиалагч тал дээрх баталгаажуулсан ажлын зургууд болон үндсэн шийдлүүдэд цаашид өөрчлөлт
          оруулахгүй болно. Хэрэв захиалагчийн хүсэлтээр зайлшгүй нэмэлт өөрчлөлт оруулах тохиолдолд
          үүнээс үүдэн гарах хугацаа болон зардлын зохицуулалтыг талууд харилцан зөвшилцөж шийдвэрлэнэ.
        </T>
      </p>

      {/* ⚠️ 2 баганат grid — ХУВААГДВАЛ багана нь тал хуудсанд тасарч огт
          таарахгүй харагдана.  Бүхэлдээ НЭГ нэгж (data-a4-item).
          Дараалал: [зүүн нүд, баруун нүд] × 5 мөр.

          ⚠️ МӨРИЙН ДАРААЛАЛ нь албан бичгийн жишгээр (эзний шийдвэр,
          2026-08-26): байгууллага → төлөөлөгч → ГАРЫН ҮСЭГ+ТАМГА → огноо.
          Тамга нь ОГНООНЫ ДЭЭД мөрөнд, өөрөөр хэлбэл доороосоо 2 дахьд
          байх ЁСТОЙ.  Урьд нь гарчгийн ЯГ доор (дээрээсээ 2 дахь) байсан
          тул тамга «Гүйцэтгэгч байгууллагын нэр»-ийн дээр гарч, бодит
          баримтын дараалалтай зөрж байв. */}
      <div className="perf-final__sign" data-a4-item>
        {/* --- мөр 1: гарчиг --- */}
        <ColTitle kp={KP_EXEC} title="Хүлээлгэж өгсөн" titleEn="Submitted by" />
        <ColTitle
          kp={KP_CLIENT}
          title="Хянаж, баталгаажуулсан"
          titleEn="Reviewed and Approved by"
        />

        {/* --- мөр 2: байгууллагын нэр --- */}
        <ValueField
          kp={KP_EXEC}
          field="org"
          label="Гүйцэтгэгч байгууллагын нэр:"
          en="Your Company Name"
          defaultValue=""
        />
        <ValueField
          kp={KP_CLIENT}
          field="org"
          label="Захиалагч байгууллагын нэр:"
          en="Client Company Name"
          /* Дээд хэсгийн «1.1 Ерөнхий мэдээлэл»-ийн захиалагчийн нэр
             автоматаар — override байвал хэрэглэгчийнх давамгайлна. */
          defaultValue={clientName || ''}
        />

        {/* --- мөр 3: төлөөлөгчийн нэр, албан тушаал --- */}
        <ValueField
          kp={KP_EXEC}
          field="rep"
          label="Төлөөлөгчийн нэр, албан тушаал:"
          en="Your Name & Title"
          /* Тайланг үүсгэсэн хүний нэр автоматаар — override давамгайлна.
             ЯГ ЭНЭ утга нь гарын үсгийг ч асаадаг (`signoffSigner.ts`). */
          defaultValue={signerName}
        />
        <ValueField
          kp={KP_CLIENT}
          field="rep"
          label="Төлөөлөгчийн нэр, албан тушаал:"
          en="Client Representative Name & Title"
          defaultValue=""
        />

        {/* --- мөр 4: гарын үсэг + ТАМГА (огнооны ЯГ дээр) --- */}
        <StampCell kp={KP_EXEC} signatureUrl={execSignatureUrl} stampUrl={execStampUrl} />
        {/* Захиалагч тал — зураг байхгүй, ГАРААР дарах ЗАЙ.  Ижил өндөртэй
            хоосон бүс тул хоёр багана тэгш хэвээр үлдэнэ. */}
        <StampCell kp={KP_CLIENT} signatureUrl={null} stampUrl={null} />

        {/* --- мөр 5: огноо --- */}
        <ValueField
          kp={KP_EXEC}
          field="date"
          label="Огноо:"
          en="Date"
          defaultValue={dateDefault}
          last
        />
        <ValueField
          kp={KP_CLIENT}
          field="date"
          label="Огноо:"
          en="Date"
          defaultValue={dateDefault}
          last
        />
      </div>

      <PageFooter />
    </div>
  );
}

/** Grid-ийн 1-р мөрийн НЭГ нүд — баганын гарчиг.
 *
 *  ⚠️ ХОЁР БҮТЭН ӨРГӨНТЭЙ МӨР, нэг мөрөнд inline БИШ (2026-08-26).
 *  Урьд нь гарчиг ба англи хос нь `display:inline` span байсан
 *  (`T` → `EditableText` → span).  Inline элемент нь ЗӨВХӨН өөрийн
 *  үсгийн өргөнийг эзэлдэг тул доорх хар зураасны дээрх ХООСОН зай
 *  дээр дарахад ямар ч contentEditable онохгүй — хэрэглэгч «энэ input
 *  дээр юм бичиж болохгүй байна» гэж мэдээлсэн.  `ValueField`-ийн утга
 *  нь `display:block; width:100%` тул тэнд хаана ч дарж болдог; энэ
 *  ялгаа нь тэндээс гарч байв.
 *
 *  Одоо мөр бүр бүтэн өргөнтэй — зураасны дээрх БҮХ талбай дарагдана.
 *  Нэмэлт ашиг: баруун баганын гарчиг («Хянаж, баталгаажуулсан
 *  (Reviewed and Approved by)») аль хэдийн 2 мөр болдог байсан тул
 *  хоёр багана одоо АЛГОРИТМААР ижил өндөртэй боллоо.
 *
 *  Англи мөрийн хаалт нь ЖИНХЭНЭ текст хэвээр (баримтын бусад хэсэгтэй
 *  нэгэн жигд) тул тэр мөрөнд span нь inline үлдэнэ — түүний баруун
 *  талын хоосон зайг `focusNearestEditable` хариуцна. */
function ColTitle({ kp, title, titleEn }: { kp: string; title: string; titleEn: string }) {
  return (
    <div className="perf-final__col-title" onMouseDown={focusNearestEditable}>
      <div className="perf-final__col-title-mn">
        <T k={kp + '.h.title'}>{title}</T>
      </div>
      <div className="perf-final__col-title-en">
        <em>
          (<T k={kp + '.h.title.en'}>{titleEn}</T>)
        </em>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
 * Хоосон зайд дарахад ХАМГИЙН ОЙРХОН contentEditable-ыг фокуслана.
 * -------------------------------------------------------------
 * Хэрэглэгчийн загвар: «зураасны дээрх талбай = input».  Гэтэл `T` нь
 * span (inline) render хийдэг тул зөвхөн үсэгнийх нь өргөнөөр дарагдана.
 * Бүтэн өргөнтэй мөр (`--col-title-mn`) энэ асуудлыг ихэнхдээ шийднэ ч
 * англи мөрийн хаалтын араас үлдэх зай хэвээр — энэ нь түүнийг барина.
 *
 * ⚠️ `mousedown` (click БИШ): фокусыг browser-ийн анхдагч сонголт
 * тавихаас ӨМНӨ авах ёстой, эс бөгөөс caret эцэг div дээр тогтоод
 * бичилт хаашаа ч орохгүй.
 *
 * ⚠️ Дарсан газар нь аль хэдийн засварлагдах элемент дээр байвал ЮУ Ч
 * ХИЙХГҮЙ — эс бөгөөс хэрэглэгчийн онож дарсан caret-ийн байрлалыг
 * төгсгөл рүү үсэргэнэ. */
function focusNearestEditable(e: React.MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  const host = e.currentTarget;
  if (e.target !== host && (e.target as HTMLElement).closest('[contenteditable="true"]')) return;

  const fields = Array.from(host.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
  if (fields.length === 0) return;

  let best: HTMLElement | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const f of fields) {
    const r = f.getBoundingClientRect();
    // Босоо зай нь ДАВАМГАЙЛНА (×1000): нэг мөрийн баруун талын зай нь
    // доод мөрийн шууд дээрх зайнаас илүү «тэр мөрийнх» гэж мэдрэгдэнэ.
    const dy = Math.max(0, r.top - e.clientY, e.clientY - r.bottom);
    const dx = Math.max(0, r.left - e.clientX, e.clientX - r.right);
    const dist = dy * 1000 + dx;
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  if (!best) return;

  e.preventDefault();
  best.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(best);
  range.collapse(false); // төгсгөлд
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Grid-ийн 2-р мөрийн НЭГ нүд — тамга + гарын үсэг.
 *  ⚠️ Өндөр нь ТОГТМОЛ («height», «min-height» БИШ): зураг ачаалагдаагүй
 *  эсвэл огт байхгүй үед ч хуудасны тооцоо (A4 paginator) хөвөхгүй. */
function StampCell({
  kp,
  signatureUrl,
  stampUrl,
}: {
  kp: string;
  signatureUrl: string | null;
  stampUrl: string | null;
}) {
  return (
    <div className="perf-final__field">
      <div className="perf-final__field-label">
        <T k={kp + '.lbl.sign'}>Гарын үсэг:</T>
      </div>
      <div className="perf-final__stamp">
        <div className="perf-final__stamp-line">
          {signatureUrl && (
            <HandSignature
              className="perf-final__stamp-sign"
              src={signatureUrl}
              fitToInk={{ maxHeightMm: SIGN_IMG_MM, maxWidthMm: 45 }}
            />
          )}
          {stampUrl && <img className="perf-final__stamp-seal" src={stampUrl} alt="" />}
        </div>
      </div>
      <div className="perf-final__field-en">
        <em>
          (<T k={kp + '.lbl.sign.en'}>Signature</T>)
        </em>
      </div>
    </div>
  );
}

/** Grid-ийн 3/4/5-р мөрийн НЭГ нүд — шошго + ЗАСВАРЛАГДАХ утга + англи тайлбар.
 *
 *  ⚠️ Өмнө нь энэ нь «.perf-final__field-line» — ердөө хоосон зураас байсан тул
 *  хэрэглэгч түүн дээр ЮУ Ч бичиж чаддаггүй байв.  Одоо зураас нь утгын
 *  элементийн «border-bottom» бөгөөд утга нь «T» — өөрөөр хэлбэл хэвлээд гараар
 *  бөглөх боломж ХЭВЭЭР, дээрээс нь шууд бичих боломж НЭМЭГДСЭН. */
function ValueField({
  kp,
  field,
  label,
  en,
  defaultValue,
  last,
}: {
  kp: string;
  /** org | rep | date — шошго/утгын түлхүүрийн сүүл. */
  field: 'org' | 'rep' | 'date';
  label: string;
  en: string;
  /** Override байхгүй үед хэвлэгдэх текст (хоосон байж болно). */
  defaultValue: string;
  /** Сүүлийн мөр — доод захын зай хэрэггүй. */
  last?: boolean;
}) {
  const cls = last ? 'perf-final__field perf-final__field--last' : 'perf-final__field';
  return (
    <div className={cls} onMouseDown={focusNearestEditable}>
      <div className="perf-final__field-label">
        <T k={kp + '.lbl.' + field}>{label}</T>
      </div>
      <div className="perf-final__field-value">
        <T k={kp + '.val.' + field}>{defaultValue}</T>
      </div>
      <div className="perf-final__field-en">
        <em>
          (<T k={kp + '.lbl.' + field + '.en'}>{en}</T>)
        </em>
      </div>
    </div>
  );
}
