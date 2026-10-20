/**
 * MGL AI · НОРМЫН ХӨРВҮҮЛСЭН БҮРТГЭЛИЙН ТӨРЛҮҮД (канон дүрслэл).
 *
 * ⚠️ ЭНЭ ФАЙЛ БОЛ ГЭРЭЭ.  `ai/norm-compiler` нь өгөгдлийн багцыг (dataset
 *    package) ЭНЭ хэлбэрт хөрвүүлж `generated/*.generated.ts` болгон бичнэ;
 *    `norm/engine.ts` нь ЭНЭ хэлбэрийг л уншина.  Багц бүр өөр файлын
 *    бүтэцтэй ирдэг (BD 21-101-12: room/v/building rules + formulas; бусад
 *    MCIS багц: duty/numeric rules) — тэр олон хэлбэрийг НЭГ канон болгох нь
 *    хөрвүүлэгчийн адаптерын ажил, хөдөлгүүрийнх БИШ.
 *
 * ⚠️ ҮҮСГЭСЭН ФАЙЛЫГ ГАРААР ЗАСАХГҮЙ.  `cd ai && npm run ai:norm:generate`
 *    (`-- --check` нь хуучирсныг барина).  Бүртгэл нь багцын SHA-256-г
 *    (`datasetSha256`) тээж явдаг тул ажилтны PC-ийн локал SQLite (мөн тэр
 *    багцаас шингээгдсэн) болон энэ бүртгэл ИЖИЛ хувилбар эсэхийг runtime
 *    дээр тулгаж болно — `NORM_DATA_VERSION_MISMATCH` (drift.ts).
 *
 * ⚠️ ГҮЙЦЭТГЭХ БОЛОМЖТОЙ ЭСЭХ нь бичлэгийн `verificationStatus`-аас
 *    ТУСДАА туг (`executable`): хөрвүүлэгч цагаан жагсаалтаар шийднэ,
 *    хөдөлгүүр тугийг Л уншина — «needs_human_review» бичлэг ХЭЗЭЭ Ч
 *    эрх бүхий шийдвэр гаргахгүй (README-ийн дүрэм).
 */

/** Баримтын хууль ёсны хүчин төгөлдөр байдлын ТОГТМОЛ төлөв (Amendment D). */
export type CurrentnessState =
  | 'IN_FORCE_VERIFIED'
  | 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED'
  | 'LISTED_CURRENT_NOT_SOURCE_VERIFIED'
  | 'NEEDS_HUMAN_REVIEW'
  | 'HISTORICAL'
  | 'SUPERSEDED'
  | 'DRAFT'
  | 'UNKNOWN';

/** Эх сурвалжийн ХАЯГ — утга бүр энэ объекттой ХАМТ явна (§8). */
export interface CompiledProvenance {
  documentId: string;
  documentCode: string;
  /** Багцын бичлэгийн id (rule_id / formula_id / chunk_id) — ЯГ хэвээр. */
  recordId: string;
  section: string | null;
  clause: string | null;
  table: number | null;
  /** Томьёоны дугаар («22», «classification_condition»). */
  formula: string | null;
  page: number | null;
  /** Багцын түүхий мөр (`verified_from_page_image`, `needs_human_review`, …). */
  verificationStatus: string;
}

/** Нөхцөлийн мод — nested any/all, тоон харьцуулагч, enum, туг. */
export type CompiledPredicate =
  | {
      kind: 'number';
      field: string;
      op: '>' | '>=' | '<' | '<=' | '=' | 'between';
      value: number | [number, number];
      unit: string | null;
    }
  | { kind: 'enum'; field: string; in: string[] }
  | { kind: 'flag'; field: string; value: boolean }
  | { kind: 'not_category'; categories: string[] }
  | { kind: 'any'; of: CompiledPredicate[] }
  | { kind: 'all'; of: CompiledPredicate[] };

/**
 * ХИЛИЙН ЗӨРЧИЛ — гүйцэтгэх бичлэг ба эх бичвэр яг нэг утга дээр
 * санал нийлэхгүй (Amendment C: 28 °C — JSON `lte 28`, проз «28°C-аас бага»).
 * Хөдөлгүүр тэр утга дээр ХЭЗЭЭ Ч эрх бүхий ангилал өгөхгүй.
 */
export interface CompiledBoundaryConflict {
  field: string;
  value: number;
  executableOp: string;
  proseOp: string;
  reason: 'source_boundary_conflict';
  detailMn: string;
}

export type CompiledRuleFamily =
  | 'room_category'
  | 'v_subcategory'
  | 'building_category'
  | 'fallback_ratio'
  | 'shutoff_time'
  | 'spacing';

export interface CompiledRule {
  ruleId: string;
  family: CompiledRuleFamily;
  /** «А», «Б», «В1-В4», «В2», «Г», «Д» — ангиллын дүрэмд. */
  category: string | null;
  priority: number;
  predicate: CompiledPredicate | null;
  /** Дараагийн алхмын арга — `apply_4_20`, `10m2_arbitrary_section_and_spacing`. */
  method: string | null;
  /** Хүнд харагдах тайлбар — эх бичвэрийн хэсэг эсвэл дүрмийн тодорхойлолт. */
  descriptionMn: string;
  reviewNote: string | null;
  /** fallback_ratio: `value` = харьцаа (0.8), shutoff_time: секунд. */
  value: number | null;
  provenance: CompiledProvenance;
  executable: boolean;
  boundaryConflicts: CompiledBoundaryConflict[];
}

export interface CompiledFormula {
  formulaId: string;
  section: string;
  number: string;
  nameMn: string;
  equationLatex: string;
  /** Багцын Python илэрхийлэл — БАРИМТЖУУЛАЛТ, ГҮЙЦЭТГЭХГҮЙ (eval ҮГҮЙ). */
  expressionPython: string | null;
  inputs: string[];
  output: { name: string; unit: string };
  constraints: Record<string, number>;
  provenance: CompiledProvenance;
  executable: boolean;
}

/** Эшлэлд хэрэгтэй эх бичвэр — зөвхөн дүрэм/томьёоны холбогдох хэсгүүд. */
export interface CompiledClause {
  chunkId: string;
  section: string | null;
  page: number | null;
  kind: string;
  textMn: string;
  verificationStatus: string;
}

/** Багцын алтан тооцооны кейс — бүртгэлийн ӨӨРИЙН регресс тест. */
export interface CompiledCase {
  caseId: string;
  queryMn: string;
  queryLatin: string | null;
  queryEn: string | null;
  inputs: Record<string, number | string | boolean>;
  expected: Record<string, number | string | boolean>;
  recordId: string | null;
  page: number | null;
}

export interface CompiledDocument {
  documentId: string;
  documentCode: string;
  /** Кодын хувилбарууд («BD 21-101-12», «21-101-12») — явцуу код танихад. */
  codeAliases: string[];
  titleMn: string;
  titleEn: string | null;
  /** Багцын түүхий `legal_status` / `effective_status` мөр. */
  legalStatusRaw: string;
  currentness: CurrentnessState;
  effectiveFrom: string | null;
  /** Багцын таних тэмдэг (Amendment A). */
  datasetId: string;
  datasetVersion: string;
  /** Багцын файлуудын SHA-256 (`datasetIdentity.ts`) — локал SQLite-тэй тулгана. */
  datasetSha256: string;
  /** Эх PDF-ийн SHA-256 (багц өөрөө мэдээлсэн). */
  sourceSha256: string;
  datasetFiles: string[];
  generatorVersion: string;
  rules: CompiledRule[];
  formulas: CompiledFormula[];
  clauses: CompiledClause[];
  cases: CompiledCase[];
}

export interface RegistryManifestEntry {
  documentId: string;
  documentCode: string;
  datasetId: string;
  datasetVersion: string;
  datasetSha256: string;
  sourceSha256: string;
  generatorVersion: string;
  /** Хөрвүүлсэн баримтын JSON-ы SHA-256 — файлыг гараар засахыг барина. */
  contentSha256: string;
  counts: { rules: number; formulas: number; clauses: number; cases: number };
}

export interface RegistryManifest {
  version: number;
  generatorVersion: string;
  documents: RegistryManifestEntry[];
}
