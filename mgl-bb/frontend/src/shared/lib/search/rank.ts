import type { LucideIcon } from 'lucide-react';

import { foldCodeVariants, foldSearchText, foldSearchTokens } from './normalize';

/**
 * Хайлтын мөрийн ТӨРӨЛ — ижил оноотой үед эрэмбэлэхэд болон дүрс/тайлбар
 * сонгоход хэрэглэнэ.
 *   page    — sidebar-ын цэсний хуудас
 *   section — хуудасны ДОТООД хэсэг («Ирц → Илүү цаг»)
 *   project — өгөгдлөөс ирсэн төслийн нэр
 *   record  — өгөгдлийн бусад бичлэг (шифр, баримт, ЗХ-ын төсөл…)
 *   action  — шилжилт биш, шууд гүйцэтгэх үйлдэл (гарах, хэл солих…)
 */
export type SearchEntryKind = 'page' | 'section' | 'project' | 'record' | 'action';

/** Хайлтын нэг мөр — цэсний холбоос, хуудасны хэсэг эсвэл үйлдэл. */
export type SearchEntry = {
  id: string;
  icon: LucideIcon;
  label: string;
  /** Мөрний доор гарах бүдэг тайлбар (бүлэг эсвэл эцэг хуудасны нэр). */
  hint?: string;
  /** Нэмэлт синонимууд — хоёр хэлээр, сул зайгаар. */
  keywords?: string;
  /**
   * ТҮҮХИЙ шифрүүд (drawing_no, doc_no, төслийн шифр…).  Дуудагч фолдын
   * дүрмийг мэдэх шаардлагагүй — `prepareSearchEntries` өөрөө
   * `foldCodeVariants`-аар өргөтгөнө.
   * ⚠️ Зөвхөн КОД оруул.  Чөлөөт текст оруулбал «ХАС» → 'xac' болж
   * худал таарц үүсгэнэ.
   */
  codes?: string[];
  /** Шилжих зам — үйлдлийн мөрөнд байхгүй. */
  to?: string;
  /** Шилжихийн оронд гүйцэтгэх үйлдэл. */
  run?: () => void;
  kind: SearchEntryKind;
};

/** Урьдчилан fold хийсэн мөр — товчлуур дарах бүрт дахин тооцохгүйн тулд. */
export type PreparedEntry = SearchEntry & {
  /** @internal */
  _label: string;
  /** @internal — түлхүүр үг + hint + зам, нэг мөрөнд. */
  _extra: string;
  /** @internal — `codes`-ийн БҮХ хувилбар (фонетик + глиф), зайгаар. */
  _codes: string;
};

/*
 * Талбарын СУУРЬ оноо.  Бага нь дээр.  Талбар доторх нарийн оноо (0–2) дээр
 * нэмэгддэг тул талбарууд хоорондоо хэзээ ч давхцахгүй:
 *   шошго          0 · 1 · 2
 *   ШИФР           3          — нарийн оноогүй, бүтэн кодын таарц
 *   түлхүүр үг     4 · 5 · 6
 *   ойролцоо       9
 * ⚠️ ШИФР нь шошгоны дараа, түлхүүр үгийн өмнө: «MEC-25/21» гэж бичсэн хүн
 * тухайн төслийг л хайж байгаа нь тодорхой, харин шошго дээрх шууд таарц
 * (нэрээр нь бичсэн) илүү хүчтэй хэвээр.
 */
const BASE_LABEL = 0;
const BASE_CODE = 3;
const BASE_EXTRA = 4;
const BASE_FUZZY = 9;

/** Ижил оноотой үед: хуудас → хэсэг → төсөл → бичлэг → үйлдэл. */
const KIND_WEIGHT: Record<SearchEntryKind, number> = {
  page: 0,
  section: 1,
  project: 2,
  record: 3,
  action: 4,
};

/**
 * Талбар доторх таарц:
 *   0 — талбар нь тухайн үгээр ЭХЭЛНЭ      («Ирц» ← «ир»)
 *   1 — ҮГИЙН эхэнд таарна                  («Илүү цаг» ← «цаг»)
 *   2 — үгийн дунд таарна                   («Хэрэглэгчид» ← «глэ»)
 *   null — таарахгүй
 */
function matchIn(haystack: string, token: string): number | null {
  if (!haystack) return null;
  const at = haystack.indexOf(token);
  if (at < 0) return null;
  if (at === 0) return 0;
  return haystack[at - 1] === ' ' ? 1 : 2;
}

/**
 * Дараалсан (subsequence) таарц — үсэг дундуур алгасаж бичсэн үед
 * («хшгтн» → «Хөшигтийн»).  Богино үгэнд БҮГД таарах тул 4-өөс богинод
 * хэрэглэхгүй, мөн хэт тарсан таарцыг (үсэг хоорондын зай их) хаяна.
 */
function matchFuzzy(haystack: string, token: string): boolean {
  if (token.length < 4 || haystack.length < token.length) return false;
  let start = -1;
  let i = 0;
  for (let j = 0; j < haystack.length && i < token.length; j += 1) {
    if (haystack[j] !== token[i]) continue;
    if (i === 0) start = j;
    i += 1;
    // Хэт тарсан — «abc» гэдэг нь 40 тэмдэгтийн дундуур байвал таарц биш.
    if (j - start > token.length * 3) return false;
  }
  return i === token.length;
}

/** Мөр бүрийн харьцуулах хэлбэрийг урьдчилан бэлдэнэ (`useMemo`-той хамт). */
export function prepareSearchEntries(entries: SearchEntry[]): PreparedEntry[] {
  return entries.map((entry) => ({
    ...entry,
    _label: foldSearchText(entry.label),
    // ⚠️ Замаас `/app` угтварыг хасна — эс тэгвэл БҮХ мөр «app» агуулж,
    // «a» гэсэн нэг үсэг бүх цэсийг илэрц болгон буцаана.  Мөн query-string
    // (`?section=overtime`) нь өөрөө сайн түлхүүр үг тул үлдээнэ.
    _extra: foldSearchText(
      `${entry.hint ?? ''} ${entry.keywords ?? ''} ${(entry.to ?? '').replace(/^\/app/, '')}`,
    ),
    // ⚠️ Хадгалагдсан талын БҮХ хувилбар.  Хайлтын талд ч мөн адил
    // өргөтгөх ёстой (`rankSearchEntries`) — таарц гэдэг нь ОГТЛОЛЦОЛ.
    _codes: (entry.codes ?? []).flatMap((code) => foldCodeVariants(code)).join(' '),
  }));
}

/**
 * Эрэмбэлсэн илэрц.
 *
 * Хайлтын мөрийг үгсэд хувааж, үг БҮР ямар нэг талбараас таарахыг шаардана
 * (AND).  Ингэснээр «ирц илүү» гэж бичихэд «Ирц → Илүү цаг» ганцаараа
 * үлдэнэ — өмнөх `includes()` хайлт нь сул зайтай мөрөнд огт таардаггүй байв.
 */
export function rankSearchEntries(
  entries: PreparedEntry[],
  query: string,
  limit = 24,
): PreparedEntry[] {
  const tokens = foldSearchTokens(query);
  if (tokens.length === 0) return [];

  // ⚠️ Хайлтын мөрийг БҮХЭЛД нь нэг шифр гэж үзээд хувилбаруудыг НЭГ УДАА
  // тооцно.  Зай бүрэн хасагддаг тул «мец 25 21» ба «MEC-25/21» нэг мөр
  // ('mec2521') болно.  Хадгалагдсан талын хувилбартай ОГТЛОЛЦВОЛ таарна.
  // ⚠️ 3 тэмдэгтээс богиныг хаяна: «a» гэсэн нэг үсэг бараг бүх шифрийн
  // дэд мөр болох тул шифртэй БҮХ мөрийг илэрц болгон буцаана.  Бодит
  // шифр хамгийн багадаа 'ba01' урттай.
  const queryCodes = foldCodeVariants(query).filter((code) => code.length >= 3);

  const scored: { entry: PreparedEntry; score: number; order: number }[] = [];

  entries.forEach((entry, order) => {
    // Мөрний шифр хайлтын шифртэй огтлолцвол үг БҮРИЙГ хангасанд тооцно —
    // «MEC-25/21» нь `mec`/`25`/`21` гэсэн гурван үг болж задардаг тул
    // үгчлэн шаардвал огт таарахгүй.
    const codeHit =
      entry._codes.length > 0 && queryCodes.some((code) => entry._codes.includes(code));

    let total = 0;
    for (const token of tokens) {
      const label = matchIn(entry._label, token);
      let best = label === null ? null : BASE_LABEL + label;
      if (best !== 0 && codeHit) best = Math.min(best ?? Infinity, BASE_CODE);
      if (best !== 0) {
        const extra = matchIn(entry._extra, token);
        if (extra !== null) best = Math.min(best ?? Infinity, BASE_EXTRA + extra);
      }
      if (best === null && matchFuzzy(entry._label, token)) best = BASE_FUZZY;
      // Нэг ч үг таарахгүй бол мөр бүхэлдээ унана.
      if (best === null) return;
      total += best;
    }
    scored.push({ entry, score: total, order });
  });

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      KIND_WEIGHT[a.entry.kind] - KIND_WEIGHT[b.entry.kind] ||
      a.entry.label.length - b.entry.label.length ||
      a.order - b.order,
  );

  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Тодруулах хэсгийн БАЙРШИЛ (түүхий шошго дотор).
 *
 * fold нь урттай тоглодог (ц → ts, давхар үсэг хураах) тул fold хийсэн
 * индексийг түүхий мөрөнд буцааж буулгах боломжгүй.  Тиймээс тодруулгыг
 * ЗӨВХӨН шууд таарц дээр хийнэ — латинаар бичсэн кирилл илэрц тодрохгүй ч
 * жагсаалтад ГАРНА, энэ нь чухал.
 */
export function findHighlight(label: string, query: string): { at: number; len: number } | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const hay = label.toLowerCase();
  for (const token of [needle, ...needle.split(/\s+/)]) {
    if (token.length < 2) continue;
    const at = hay.indexOf(token);
    if (at >= 0) return { at, len: token.length };
  }
  return null;
}
