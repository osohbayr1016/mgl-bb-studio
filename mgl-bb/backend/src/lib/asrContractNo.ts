/**
 * ЗХ-ийн «Гэрээний дугаар» — төслийн түвшний утга ба тайлангийн хүчингүйлэгч
 * (эзний хүсэлт 2026-09-30, миграц 0365).
 *
 * Хоёр хадгалалт, ШИФРИЙН (`shifr` ↔ `project_passport.drawing_no`) ижил хэлбэр:
 *   • `projects.asr_contract_no`             — төслийн дугаар (ЗХ төсөл нэмэх /
 *                                              нэр засах цонхонд бичнэ);
 *   • `author_supervision_reports.contract_no` — тайлангийн ХҮЧИНГҮЙЛЭГЧ
 *                                              (0363, засварлагч дээр гараар).
 * Хүчин төгөлдөр утга = хүчингүйлэгч ?? төслийн дугаар.  Шифрээс ялгаатай нь
 * илгээх үед ХӨЛДӨХГҮЙ — эзний шийдвэр: төсөл дээрх БҮХ тайлан (илгээгдсэн нь ч)
 * төслийн одоогийн дугаарыг ашиглана.
 *
 * Цэвэр (D1-гүй) тул `node --test`-ээр шууд ачаалагдана.
 */

const clean = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

/**
 * Тайлангийн мөрөнд төслийн дугаарыг гаргах скаляр дэд асуулга.
 * ⚠️ `r` нь `author_supervision_reports`-ийн alias.  Энэ бол SQL-ийн хэсэг —
 *    дуудагч нь template literal-д шигтгэдэг тул ЭНД BACKTICK бүү бич.
 */
export const PROJECT_CONTRACT_SQL = `(SELECT NULLIF(TRIM(asr_contract_no), '')
                                 FROM projects WHERE id = r.project_id)`;

/** Тайлангийн `contract_no` (хүчингүйлэгч) — төслийн дугаар солигдоход цэвэрлэнэ. */
export const CLEAR_REPORT_CONTRACT_OVERRIDES_SQL = `UPDATE author_supervision_reports
    SET contract_no = NULL
  WHERE project_id = ? AND contract_no IS NOT NULL`;

export interface ResolvedContractNo {
  /** ХҮЧИН ТӨГӨЛДӨР дугаар — хэвлэх, Word, жагсаалт үүнийг уншина. */
  contract_no: string | null;
  /** Засварлагчийн талбар ЗӨВХӨН үүнийг харуулна. */
  contract_no_override: string | null;
  /** `'override'` | `'project'` | `null` — UI «Авто (төслөөс)» гэж хэлнэ. */
  contract_no_source: 'override' | 'project' | null;
  project_contract_no: string | null;
}

/** Тайлангийн хүчингүйлэгч ба төслийн дугаараас хүчин төгөлдөр утгыг гаргана. */
export function resolveAsrContractNo(
  reportOverride: unknown,
  projectContractNo: unknown,
): ResolvedContractNo {
  const override = clean(reportOverride);
  const project = clean(projectContractNo);
  return {
    contract_no: override ?? project,
    contract_no_override: override,
    contract_no_source: override ? 'override' : project ? 'project' : null,
    project_contract_no: project,
  };
}

export interface ContractNoUpdate {
  /** `projects.asr_contract_no`-д бичих утга (хоосон → `null`). */
  value: string | null;
  /**
   * `true` бол тэр төслийн тайлангуудын гараар бичсэн `contract_no`-г
   * цэвэрлэнэ (бүгд төслийг дагана).  Зөвхөн ШИНЭ, хоосон биш дугаар тогтсон
   * үед: өөрчлөгдөөгүй дугаарыг дахин хадгалахад сүүлд бичсэн утгууд
   * хөндөгдөхгүй, дугаарыг ХАСАХАД тайлангуудын утга хэвээр үлдэнэ.
   */
  clearReportOverrides: boolean;
}

export function planContractNoUpdate(current: unknown, next: unknown): ContractNoUpdate {
  const before = clean(current);
  const value = clean(next);
  return { value, clearReportOverrides: value != null && value !== before };
}
