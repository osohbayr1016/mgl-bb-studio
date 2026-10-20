/**
 * MGL AI · ЭШЛЭЛ ҮҮСГЭГЧ (§11-ийн «citation»).
 *
 * ⚠️ ЭШЛЭЛИЙГ ЗАГВАР ЗОХИОХГҮЙ.  Загварын гаргасан «[3]» гэсэн дугаар нь
 *    зохиомол байж болно — тиймээс эшлэл нь ЭНД, өгөгдлийн сангийн мөрөөс
 *    угсрагдана.  `promptFrame`-д очих нотолгооны жагсаалт ба хэрэглэгчид
 *    харагдах эшлэл нь НЭГ эх сурвалжтай.
 *
 * ⚠️ ХУУЧИРСАН НОРМ НЬ ЭШЛЭЛИЙН ХЭСЭГ.  `document.json`-ий
 *    `effective_status = 'unknown_requires_legal_verification'` нь бодит
 *    төлөв: 2018 оны нэмэлтийг дараагийн өөрчлөлт орлуулсан эсэхийг хэн ч
 *    шалгаагүй.  Түүнийг нуух нь мэргэжлийн эрсдэл, тиймээс эшлэл бүр
 *    `legal_review_required` тугийг үүрнэ.
 */

export interface Citation {
  document: string;
  doc_id: string;
  table: number | null;
  row: string | null;
  clause: string | null;
  page: number | null;
  /** Хүнд харагдах мөр — UI шууд хэвлэнэ. */
  label_mn: string;
  /**
   * Баримтын НЭР («Барилгын талбайн даамлын үлгэрчилсэн дүрэм») — хүнд ойлгомжтой эшлэл, хүчин төгөлдөр байдлын
   * хариултад (2026-09-23).  Хуучин Worker үүнийг уншдаггүй — нэмэлт талбар, гэрээ эвдэхгүй.
   */
  title_mn: string;
  /** ⚠️ Хүчинтэй эсэхийг ХУУЛИЙН хүн шалгах ёстой гэсэн тод анхааруулга. */
  legal_review_required: boolean;
  effective_status: string;
  /**
   * АЛБАН ЁСНЫ эх сурвалжийн URL — багц өгсөн бол.
   *
   * ⚠️ БНбД 11-03-21 GOLD v3 (2026-09-10) ирэхэд НЭМЭГДСЭН: тэр багцын
   *    `answer_source_contract.json` нь норматив хариулт бүрд «Эх сурвалж:
   *    <код>, <хаяг> — <URL>» мөрийг ХАРАГДАХУЙЦ шаарддаг.  URL нь хэсгийн
   *    метадатаас (`answer_source.url` / `source_locator.url`), байхгүй бол
   *    баримтын `authoritative_current_text_url`-аас; хоёулаа байхгүй бол
   *    `null` — ЗОХИОХГҮЙ (гэрээний 7-р дүрэм).  Зөвхөн `https://`.
   */
  source_url: string | null;
  /** «Эх сурвалж: БНбД 11-03-21, заалт 3.9 — https://…» — гэрээний хүнд уншигдах хэлбэр. */
  source_label_mn: string;
  /** Багцын таних тэмдэг (Amendment A) — Worker-ийн бүртгэлтэй тулгахад; хуучин багцад null. */
  dataset_sha256: string | null;
  dataset_version: string | null;
  dataset_id: string | null;
}

export interface CitationSource {
  dataset_sha256?: string | null;
  dataset_version?: string | null;
  dataset_id?: string | null;
  doc_id: string;
  code: string;
  title_mn: string;
  effective_status: string;
  table_no: number | null;
  row_no: string | null;
  clause_no: string | null;
  page: number | null;
  section_path: string | null;
  source_url?: string | null;
}

/** Зөвхөн `https://` — багц дотор `http:`/`file:` орж ирвэл хаягдана. */
export function officialUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) ? v : null;
}

/**
 * ⚠️ ХЭСЭГ БҮРД ХАЯГ БАЙХГҮЙ.  Заалт нь `clause_no`-той, хүснэгтийн мөр
 *    нь `table_no + row_no`-той.  Хоёулаа байхгүй бол хуудсаар л эшилнэ —
 *    гэвч ХООСОН эшлэл ХЭЗЭЭ Ч гаргахгүй: эшлэлгүй норматив хариу нь
 *    `pipeline.ts`-д `insufficient_evidence` болно.
 */
export function buildCitation(src: CitationSource): Citation {
  const parts: string[] = [src.code];
  if (src.section_path) parts.push(src.section_path.split(' / ')[0] ?? '');
  if (src.table_no !== null) parts.push(`Хүснэгт ${src.table_no}`);
  if (src.row_no !== null) parts.push(`мөр ${src.row_no}`);
  if (src.clause_no !== null) parts.push(`заалт ${src.clause_no}`);
  if (src.page !== null) parts.push(`хуудас ${src.page}`);
  const label = parts.filter((p) => p.length > 0).join(', ');
  const url = officialUrl(src.source_url);

  return {
    document: src.code,
    doc_id: src.doc_id,
    table: src.table_no,
    row: src.row_no,
    clause: src.clause_no,
    page: src.page,
    label_mn: label,
    title_mn: src.title_mn,
    legal_review_required: src.effective_status !== 'in_force',
    effective_status: src.effective_status,
    source_url: url,
    source_label_mn: url === null ? `Эх сурвалж: ${label}` : `Эх сурвалж: ${label} — ${url}`,
    dataset_sha256: src.dataset_sha256 ?? null,
    dataset_version: src.dataset_version ?? null,
    dataset_id: src.dataset_id ?? null,
  };
}

/**
 * Эшлэл нь эх сурвалж руу БУЦААХ хангалттай хаягтай юу.
 *
 * ⚠️ ХАВСРАЛТ, ТООН БУС ХҮСНЭГТ (2026-09-11).  БНбД 31-23-12-ын Хавсралт Д-гийн
 *    36 талбайн норм, 31-24-22-ын «А хавсралт, А.1 хүснэгт» мөрүүд нь заалт,
 *    хуудас, тоон хүснэгтийн дугаар АЛЬ НЬ Ч ҮГҮЙ — тэдний хаяг нь багцын
 *    `answer_source.locator` («Хавсралт Д»), шошгын ХОЁР ДАХЬ сегмент.  Өмнөх
 *    гурван шалгуураар тэд «хаяг бүрэн бус» болж, зөв тооцсон ч `verified`
 *    болохгүй байв.  Хавсралт/хүснэгтийн үг нь баримтын кодоос хэзээ ч гарахгүй
 *    (шошгын эхний сегмент), заалтын бүлгийн нэрээс ч гарахгүй («4. Ерөнхий
 *    зүйл») тул энэ шалгуур зөвхөн жинхэнэ хаягт тэнцэнэ.  Мөрийн дугаар
 *    (`row`) ганцаараа ч хаяг — хүснэгтгүй хавсралтын мөр (СНиП-ийн 115 мөр).
 */
export function isCitable(c: Citation): boolean {
  if (c.page !== null || c.table !== null || c.clause !== null || c.row !== null) return true;
  const afterCode = c.label_mn.slice(c.document.length);
  return /хавсралт|хүснэгт|appendix|table/iu.test(afterCode);
}
