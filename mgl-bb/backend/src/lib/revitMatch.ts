/**
 * Revit-ийн ХУУДСЫГ вэбийн ЗУРАГ / АЖИЛ-тай тааруулах цэвэр логик.
 *
 * Энэ бол ЗӨВХӨН САНАЛ.  Гаралт нь `revit_sheet_bindings.status='suggested'`
 * мөр болж очих ба инженер батлах хүртэл юунд ч нөлөөлөхгүй.  Тиймээс
 * "буруу таасан" нь өгөгдөл эвдэхгүй — зөвхөн нэг мөр гараар засагдана.
 *
 * ⚠️ Салбарын кодын ХАТУУ ЖАГСААЛТ САНААТАЙГААР БАЙХГҮЙ.
 * `routes/tasks.ts` (8 код) ба `frontend/.../detail/helpers.ts` (10 код) гэсэн
 * хоёр зөрүүтэй хуулбар аль хэдийн байгаа.  Гурав дахийг нэмбэл зөрүү нэмэгдэнэ.
 * Оронд нь хуудасны дугаар БОЛОН зургийн нэрнээс үсгэн угтварыг нь ТУС ТУС
 * гаргаж шууд харьцуулна — ямар ч код (БА, ХАС, ЦБУ, EZ…) ажиллана, компани
 * шинэ код нэмэхэд энэ файл ӨӨРЧЛӨГДӨХГҮЙ.
 *
 * Кирилл↔латин нь `textFold.ts`-ээр — «БА-01» ба «BA 01» ижил гэж үзнэ.
 * `qtoNormalize.ts`-ийн `normalizeRawName`-ийг ХЭЗЭЭ Ч бүү ашигла: тэр нь
 * `х→x` фолд хийж монгол үгийг гэмтээнэ (textFold.ts-ийн тайлбарыг үз).
 */
import { foldCode, foldText } from './textFold';

export type MatchSource = 'number' | 'name' | 'discipline' | 'inherited' | 'manual';

export interface SheetInput {
  uid: string;
  number: string;
  name: string;
  placed_view_count?: number;
}

export interface DrawingCandidate {
  id: number;
  name: string;
  block_id: number;
  block_name?: string | null;
}

export interface TaskCandidate {
  id: number;
  name: string;
  drawing_id: number;
}

export interface Suggestion {
  drawing_id: number | null;
  task_id: number | null;
  match_source: MatchSource | null;
  confidence: number;
}

/** Итгэлцлийн босго — үүнээс дээш саналыг UI урьдчилан тэмдэглэнэ. */
export const AUTO_TICK_CONFIDENCE = 0.8;

/**
 * Үсгэн угтвар — эхний цифрээс өмнөх латинжуулсан үсгүүд.
 *
 *   'БА-01'          → 'ba'
 *   'BA 01'          → 'ba'
 *   'ХАС-12'         → 'has'
 *   'ЦБУ-3'          → 'cbu'      (ц→ts→c)
 *   'БА — Архитектур' → 'ba'
 *   '01'             → ''         (угтваргүй)
 */
export function codePrefix(raw: string): string {
  // ⚠️ ЭХНИЙ ҮГЭЭС авна, бүтэн мөрнөөс БИШ.  `foldCode` нь зайг хасдаг тул
  // цифргүй нэр («БА — Архитектур зураг») дээр бүтнээрээ үсэг болж хувирч,
  // угтвар нь 'baarhitekturzurag' болно.  `foldText` нь үгсийг зайгаар
  // тусгаарлаж үлдээдэг — эхний үгийн үсгэн хэсэг л бидний хайж буй код.
  const first = foldText(raw).split(' ')[0] ?? '';
  const m = first.match(/^[a-z]+/);
  return m ? m[0] : '';
}

/** Хуудасны дугаараас цифрэн хэсэг — 'БА-01' → '01'. */
export function codeNumber(raw: string): string {
  const folded = foldCode(raw);
  const m = folded.match(/\d+/);
  return m ? m[0] : '';
}

/**
 * Хоёр чөлөөт бичвэрийн үгийн ДАВХЦАЛ (Jaccard).  0..1.
 * Хоёулаа хоосон бол 0 — «хоосон нь бүгдтэй таарна» гэсэн урхийг хаана.
 */
export function tokenOverlap(a: string, b: string): number {
  const A = new Set(foldText(a).split(' ').filter((t) => t.length > 1));
  const B = new Set(foldText(b).split(' ').filter((t) => t.length > 1));
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

/**
 * Нэг хуудсанд хамгийн тохирох зураг + ажлыг санал болгоно.
 *
 * Шатлал (эхний таарсан нь ялна):
 *   1. Угтвар таарна + ажлын нэр давхцана  → 0.95  'number'
 *   2. Угтвар таарна (ганц зурагт)         → 0.85  'number'
 *   3. Угтвар таарна (олон зурагт)         → 0.60  'discipline'
 *   4. Зөвхөн нэрийн давхцал ≥ 0.5         → 0.55  'name'
 *   5. Юу ч үгүй                            → 0     null
 *
 * Ажил сонгох: тухайн зургийн ажлуудаас нэрийн давхцал ХАМГИЙН ӨНДӨР нь.
 * Давхцал 0 бол зургийн ГАНЦ ажил байвал түүнийг, олон бол null.
 */
export function suggestBinding(
  sheet: SheetInput,
  drawings: readonly DrawingCandidate[],
  tasks: readonly TaskCandidate[],
): Suggestion {
  const none: Suggestion = {
    drawing_id: null,
    task_id: null,
    match_source: null,
    confidence: 0,
  };

  const prefix = codePrefix(sheet.number);
  const byPrefix = prefix ? drawings.filter((d) => codePrefix(d.name) === prefix) : [];
  const prefixMatched = byPrefix.length > 0;

  /** Тухайн зургийн ажлуудаас хуудасны нэртэй хамгийн ойрыг нь олно. */
  const bestTaskOf = (drawingId: number): { task: TaskCandidate | null; score: number } => {
    const own = tasks.filter((t) => t.drawing_id === drawingId);
    if (own.length === 0) return { task: null, score: 0 };
    const ranked = own
      .map((t) => ({ t, s: tokenOverlap(sheet.name, t.name) }))
      .sort((x, y) => y.s - x.s);
    const best = ranked[0]!;
    // Ганц ажилтай зурагт нэр таарахгүй ч тэр ажлыг сонгоно — өөр сонголт байхгүй.
    if (best.s > 0) return { task: best.t, score: best.s };
    if (own.length === 1) return { task: own[0]!, score: 0 };
    return { task: null, score: 0 };
  };

  // --- 1) Зураг сонгох ---------------------------------------------------
  let drawing: DrawingCandidate | null = null;
  let source: MatchSource | null = null;

  const pool = prefixMatched ? byPrefix : drawings;
  const ranked = pool
    .map((d) => ({ d, byName: tokenOverlap(sheet.name, d.name), byTask: bestTaskOf(d.id).score }))
    // Зургийн нэрээр эрэмбэлнэ; тэнцвэл АЖЛЫН нэрээр таслана.  Энэ хоёр дахь
    // шалгуур нь чухал: «БА — Архитектур зураг» ба «БА — Тохижилт» хоёулаа
    // 'ba' угтвартай бөгөөд хуудасны нэртэй огт давхцахгүй байж болно, гэтэл
    // тэдний ДООРХ ажлууд ялгаатай — тэндээс зөв зураг олдоно.
    .sort((x, y) => y.byName - x.byName || y.byTask - x.byTask);

  const top = ranked[0];
  if (prefixMatched && top) {
    drawing = top.d;
    source = byPrefix.length === 1 || top.byName > 0 || top.byTask > 0 ? 'number' : 'discipline';
  } else if (top && top.byName >= 0.5) {
    drawing = top.d;
    source = 'name';
  }

  if (!drawing) return none;

  // --- 2) Ажил сонгох ----------------------------------------------------
  const { task, score: taskScore } = bestTaskOf(drawing.id);

  // --- 3) Итгэлцэл -------------------------------------------------------
  // Хамгийн өндөр нь: угтвар таарсан БӨГӨӨД ажлын нэр бараг яг давхцсан.
  let confidence: number;
  if (!task) {
    // Зураг олдсон ч ажил тодорхойгүй — инженер ЗААВАЛ сонгох ёстой.
    confidence = 0.5;
  } else if (prefixMatched && taskScore >= 0.8) {
    confidence = 0.95;
  } else if (prefixMatched && byPrefix.length === 1) {
    confidence = 0.85;
  } else if (prefixMatched) {
    confidence = 0.8;
  } else {
    confidence = 0.6;
  }

  return {
    drawing_id: drawing.id,
    task_id: task ? task.id : null,
    match_source: source,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** Дэд жагсаалтын мөрийн текст — «БА-01 — 1-р давхрын план». */
export function checklistTextForSheet(sheet: SheetInput, maxLen: number): string {
  // DB-ийн мөрийг шууд дамжуулах алдаа бодит болсон тул хамгаалалттай уншина —
  // энэ функц уначих нь бүхэл handshake-ийг унагана.
  const num = String(sheet?.number ?? '').trim();
  const name = String(sheet?.name ?? '').trim();
  const text = num && name ? `${num} — ${name}` : num || name || 'Нэргүй хуудас';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}
