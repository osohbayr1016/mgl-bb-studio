import { createContext, useCallback, useContext } from 'react';
import { EditableText } from '@/features/performance-reports/components/EditableText';

/* =============================================================
 * Гүйцэтгэлийн тайлан — ЗАСВАРЛАГДАХ СТАТИК ТЕКСТ.
 * -------------------------------------------------------------
 * `EditableText` нь тайлангийн УТГА-уудыг (төслийн нэр, захиалагч,
 * огноо…) засварлана.  Харин хүснэгтийн ШОШГО — «Project title:»,
 * «Client:», «№», «Documents», «1.1. General Information» гэх мэт —
 * эх кодын литерал байсан тул хэрэглэгч огт хөдөлгөж чаддаггүй байв
 * («I can't change the default text of the table»).
 *
 * Энэ файл тэр цоорхойг хаана:  литерал бүрийг `<T k="…">…</T>`-ээр
 * ороож өгвөл засварлах горимд contentEditable болж, хэвлэх зам дээр
 * дахин энгийн текст болж буцна.
 *
 *   <T k="intro.lbl.client">Client:</T>
 *
 * `children` нь АНХДАГЧ текст — override байхгүй үед яг энэ гарна.
 * Тиймээс код уншихад юу хэвлэгдэхийг харах боломж алдагдахгүй бөгөөд
 * override-гүй хуучин тайлан ч мөн адил хэвээрээ харагдана.
 *
 * ---------------------------------------------------------------
 * ХАДГАЛАЛТ
 * ---------------------------------------------------------------
 * Override-ууд нь блокийн `content.textOverrides` (`Record<string,
 * string>`) дотор амьдарна — `types/performanceReportBlocks.ts` дахь
 * `BlockTextOverrides`-ыг үз.  Backend `content_json`-ыг opaque JSON
 * болгон дамжуулдаг тул DB migration ШААРДЛАГАГҮЙ.
 *
 * `t(key, fallback)`-ийн ЁСТОЙ семантик (context-ыг бүтээж буй тал
 * үүнийг дагана):
 *   - override нь string бол — ХООСОН МӨР ('') байсан ч гэсэн — түүнийг
 *     буцаана.  Хоосон мөр = «хэрэглэгч энэ шошгыг зориуд арилгасан».
 *   - өөр тохиолдолд `fallback`-ыг буцаана.
 * (Яг `IntroOverride`-тэй ижил дүрэм: `undefined` = авто, '' = хүний утга.)
 *
 * ---------------------------------------------------------------
 * ТҮЛХҮҮРИЙН НЭРШЛИЙН ДҮРЭМ  —  <блок>.<хэсэг>.<талбар>
 * ---------------------------------------------------------------
 * Бүгд ЖИЖИГ үсгээр, цэгээр тусгаарлана.  Түлхүүр нь нэг блокийн
 * дотор ӨВӨРМӨЦ байх ёстой (өөр блокт ижил түлхүүр давхцаж болно —
 * тус бүр өөрийн `textOverrides`-той).
 *
 *   <блок>  cover | toc | intro | team | exec | signoff | sections
 *   <хэсэг> h    — гарчиг (heading)
 *           lbl  — талбарын шошго (label)
 *           col  — хүснэгтийн баганын толгой
 *           txt  — чөлөөт өгүүлбэр
 *   Англи/монгол хос текстийг `.en` / `.mn` дагавраар ялгана.
 *
 * Жишээ (одоо ашиглагдаж буй бодит түлхүүрүүд):
 *   intro.h.section          «1. Төслийн танилцуулга»
 *   intro.h.section.en       «Project description»
 *   intro.h.11               «1.1. General Information»
 *   intro.h.11.mn            «(Төслийн ерөнхий мэдээлэл)»
 *   intro.lbl.title          «Project title:»
 *   intro.lbl.title.mn       «(Төслийн нэр)»
 *   intro.lbl.client         «Client:»
 *   intro.lbl.client.mn      «(Захиалагч)»
 *   intro.docs.col.no        «№»
 *   intro.docs.col.name      «Documents»
 *   intro.docs.col.name.mn   «(Бичиг баримт)»
 *   intro.scope.col.dic      «DIC»
 *   cover.lbl.docno          «Doc.No»
 *   toc.title                «АГУУЛГА»
 *   exec.h.summary           «Гүйцэтгэх хураангуй»
 *   signoff.h.title          «Баталгаажуулалт»
 *   team.lbl.progress        «Явц»
 *
 * ⚠️ Түлхүүрийг ХЭЗЭЭ Ч нэрлэж болгоомжгүй сольж болохгүй — хадгалагдсан
 * override нь түлхүүрээрээ холбогддог тул нэр солих нь хэрэглэгчийн
 * засварыг чимээгүй хаяна.
 * ============================================================= */

/** `EditableText.fieldKey`-ийн угтвар.  `restoreCaret()` нь
 *  `[data-editkey]`-ээр хайдаг тул статик шошгын түлхүүр УТГЫН
 *  талбарын түлхүүртэй мөргөлдөхгүй байх ёстой. */
const TEXT_KEY_PREFIX = 'txt:';

export interface ReportTextApi {
  /** key-ийн override-ыг, байхгүй бол fallback-ыг буцаана. */
  t(key: string, fallback: string): string;
  /** null бол засварлах боломжгүй (хэвлэх зам, issued тайлан). */
  set: ((key: string, value: string) => void) | null;
}

/** Provider байхгүй үед — бүх текст анхдагчаараа, засварлах боломжгүй.
 *  Хэвлэх зам (`PerformanceReportPrintPage`) энэ горимд ажиллана. */
const FALLBACK: ReportTextApi = { t: (_k, f) => f, set: null };

export const ReportTextContext = createContext<ReportTextApi>(FALLBACK);

export function useReportText(): ReportTextApi {
  return useContext(ReportTextContext);
}

export interface TProps {
  /** Блокийн дотор ӨВӨРМӨЦ түлхүүр, ж: 'intro.lbl.client'. */
  k: string;
  /** Анхдагч текст — эх код дахь литерал.  ЗААВАЛ энгийн string. */
  children: string;
  className?: string;
  as?: 'span' | 'div' | 'em' | 'small' | 'strong';
}

/** Засварлагдах СТАТИК шошго.
 *  Засварлах горимд `EditableText`, эсрэг тохиолдолд энгийн текст. */
export function T({ k, children, className, as = 'span' }: TProps): React.JSX.Element {
  const api = useReportText();
  const set = api.set;
  const value = api.t(k, children);

  // Hook-ууд салаалахаас ӨМНӨ дуудагдана.  Тогтвортой callback —
  // `EditableText` дараа нь `React.memo` болбол дэмий render хийхгүй.
  const onChange = useCallback(
    (next: string) => {
      set?.(k, next);
    },
    [set, k],
  );

  const cls = ['perf-txt', className ?? ''].filter(Boolean).join(' ');

  if (!set) {
    // Хэвлэх зам: нэмэлт атрибутгүй, цэвэр DOM.
    const Plain = as as 'span';
    return <Plain className={cls}>{value}</Plain>;
  }

  if (as === 'span' || as === 'div') {
    return (
      <EditableText
        as={as}
        fieldKey={TEXT_KEY_PREFIX + k}
        value={value}
        onChange={onChange}
        placeholder={children}
        className={cls}
      />
    );
  }

  /* `EditableText` нь зөвхөн span/div дэмждэг (тэр файл өөр эзэмшилтэй)
   * тул em/small/strong-ыг ЭНД адаптераар боож өгнө: гадна талд хүссэн
   * тэг, дотор нь contentEditable span. */
  const Wrap = as as 'em';
  return (
    <Wrap className={cls}>
      <EditableText
        as="span"
        fieldKey={TEXT_KEY_PREFIX + k}
        value={value}
        onChange={onChange}
        placeholder={children}
      />
    </Wrap>
  );
}

/** Статик шошгын CSS.  `EDITABLE_STYLES`-ийн ард нэмэгдэнэ.
 *  Hover/focus тэмдэглэгээг `.perf-edit--on` аль хэдийн өгдөг тул
 *  энд ЗӨВХӨН шошгод хамаарах ялгаа + хэвлэлийн цэвэрлэгээ. */
export const REPORT_TEXT_STYLES = `
.perf-txt { outline: none; }
/* Бүрэн арилгасан шошгыг дахин дарж засах боломжтой байлгана. */
.perf-txt.perf-edit--on { min-width: 2ch; }
@media print {
  .perf-txt,
  .perf-txt.perf-edit--on,
  .perf-txt.perf-edit--on:hover,
  .perf-txt.perf-edit--on:focus {
    background: none !important;
    box-shadow: none !important;
    outline: none !important;
    min-width: 0 !important;
  }
  .perf-txt.perf-edit--empty::before { content: "" !important; }
}
`;
