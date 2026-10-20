/**
 * Python-ийн `repr` хэлбэрт бичигдсэн бүтэцтэй утгыг ХҮНИЙ уншихуйц бичвэр болгоно (GAP-023).
 *
 * Зарим GOLD багц (БД 21-101-12 Хүснэгт 4-ийн В-муж, СНиП II-97-76 хавсралтын нягтралын
 * хувилбарууд) `text_mn`/`search_text`/alias/тестийн асуултаа бүтэцтэй талбараас угсрахдаа
 * Python-ийн dict-ийг шууд `str()`-ээр оруулсан: `g = {'gt': 2200}`,
 * `{'without_used_attic': 51, 'with_used_attic': 45}`.  Энэ нь (1) хэрэглэгчид харагдах
 * нотолгоонд програмын дотоод бичлэг гарна, (2) FTS-д `'gt'`, `'min'` гэсэн утгагүй токен
 * ордог, (3) нормын утгыг ӨӨРЧЛӨХГҮЙ ч ХАРАГДАХ хэлбэр нь хүнд ойлгомжгүй.
 *
 * ⚠️ УТГЫГ ӨӨРЧЛӨХГҮЙ: тоо, түлхүүр бүр хэвээр; зөвхөн хэлбэр.  Нэрлэсэн хувилбарын түлхүүр
 *    (`without_used_attic`) нь багцын ЭРХ БҮХИЙ талбарын нэр тул монгол шошгын ард ХААЛТАНД
 *    хэвээр үлдэнэ — мөшгөх боломж алдагдахгүй, шошгын орчуулга буруу байсан ч эх түлхүүр
 *    харагдана.  Мэдэхгүй түлхүүр шошгогүй, өөрөө л бичигдэнэ.
 *
 * Хэрэглэгч: `datasetProfiles.ts` (шингээлтийн үед — түүхий файл засагдаагүй байсан ч
 * санд орохгүй), `scripts/normalize-dataset-repr.mjs` (түүхий багцыг ГАЗАР ДЭЭР НЬ засна).
 */

/** Нэрлэсэн хувилбарын түлхүүр → монгол шошго (СНиП II-97-76 хавсралт: нягтралын хувилбарууд). */
export const VARIANT_LABELS_MN: Readonly<Record<string, string>> = {
  without_used_attic: 'дээврийн хөндий ашиглахгүй',
  with_used_attic: 'дээврийн хөндий ашиглана',
  adult: 'насанд хүрсэн мал',
  replacement: 'нөхөн үржлийн залуу мал',
  commercial: 'таваарын сүрэг',
  parent: 'эцэг эхийн сүрэг',
  incubator: 'инкубатор',
  slaughter: 'нядалгааны цех',
  commercial_multistorey: 'таваарын сүрэг, олон давхар',
  commercial_single: 'таваарын сүрэг, нэг давхар',
  replacement_multistorey: 'нөхөн үржлийн залуу мал, олон давхар',
  replacement_single: 'нөхөн үржлийн залуу мал, нэг давхар',
  incubator_multistorey: 'инкубатор, олон давхар',
  incubator_single: 'инкубатор, нэг давхар',
  slaughter_multistorey: 'нядалгааны цех, олон давхар',
  slaughter_single: 'нядалгааны цех, нэг давхар',
  wide_span: 'өргөн алгасалтай барилга',
  pavilion: 'павильон хэлбэрийн барилга',
  rough_feed_under_shed: 'бүдүүн тэжээл саравчинд',
  rough_feed_in_stacks: 'бүдүүн тэжээл бухалд',
};

const COMPARATOR_KEYS = new Set(['gt', 'gte', 'lt', 'lte', 'min', 'max', 'eq']);
/** `{'k': v, 'k2': v2}` — зөвхөн энгийн (нэг түвшний) dict; утга нь тоо/мөр/None/bool. */
const DICT_RE = /\{\s*'[A-Za-z_][A-Za-z0-9_]*'\s*:\s*[^{}]*\}/g;
const PAIR_RE = /'([A-Za-z_][A-Za-z0-9_]*)'\s*:\s*('([^']*)'|-?\d+(?:\.\d+)?|None|True|False)/g;

function parsePairs(dict: string): { key: string; value: string }[] | null {
  const out: { key: string; value: string }[] = [];
  const body = dict.slice(1, -1);
  let consumed = '';
  for (const m of body.matchAll(PAIR_RE)) {
    out.push({ key: m[1]!, value: m[3] ?? m[2]! });
    consumed += m[0];
  }
  // Бүх агуулга хос байх ёстой (таслал, зайг эс тооцвол) — эс тэгвэл repr биш, хөндөхгүй.
  const rest = body.replace(PAIR_RE, '').replace(/[\s,]/g, '');
  return out.length > 0 && rest.length === 0 && consumed.length > 0 ? out : null;
}

/** Харьцуулагчийн dict → тэмдэгт: `{'gt': 2200}` → `> 2200`, `{'min': a, 'max': b}` → `a–b`. */
function renderComparator(pairs: { key: string; value: string }[]): string | null {
  const map = new Map(pairs.map((p) => [p.key, p.value] as const));
  if (map.size === 2 && map.has('min') && map.has('max')) return `${map.get('min')}–${map.get('max')}`;
  if (map.size !== 1) return null;
  const first = [...map.entries()][0];
  if (first === undefined) return null;
  const [k, v] = first;
  switch (k) {
    case 'gt': return `> ${v}`;
    case 'gte': return `≥ ${v}`;
    case 'lt': return `< ${v}`;
    case 'lte': return `≤ ${v}`;
    case 'eq': return `= ${v}`;
    case 'min': return `≥ ${v}`;
    case 'max': return `≤ ${v}`;
    default: return null;
  }
}

/** Нэрлэсэн хувилбар → «шошго (түлхүүр): утга» жагсаалт; хувийн утгад `%` нэмнэ (`percent=true`). */
function renderVariants(pairs: { key: string; value: string }[], percent: boolean): string {
  return pairs
    .map((p) => {
      const label = VARIANT_LABELS_MN[p.key];
      const value = p.value === 'None' ? '—' : p.value;
      const unit = percent && value !== '—' ? ' %' : '';
      return label === undefined ? `${p.key}: ${value}${unit}` : `${label} (${p.key}): ${value}${unit}`;
    })
    .join('; ');
}

export interface NormalizeReprOptions {
  /** Нэрлэсэн хувилбарын утга нь хувь (СНиП нягтралын хүснэгт) — `%` нэмнэ. */
  percentVariants?: boolean;
}

/** Бичвэрт Python repr байна уу (`{'key': …}`)? */
export function hasPythonRepr(text: string): boolean {
  DICT_RE.lastIndex = 0;
  return DICT_RE.test(text);
}

/**
 * Бичвэр доторх бүх `{'k': v}` хэлбэрийг хүний уншихуйц болгоно.
 *   `g = {'gt': 2200} МДж/м²`          → `g > 2200 МДж/м²`
 *   `g = {'min': 1401, 'max': 2200}`   → `g = 1401–2200`
 *   `хувилбарууд {'with_used_attic': 45}` → `хувилбарууд: дээврийн хөндий ашиглана (with_used_attic): 45 %`
 * Танигдахгүй dict (нэг түвшний биш, утга нь dict/list) ХЭВЭЭР үлдэнэ — `hasPythonRepr` барина.
 */
export function normalizeReprText(text: string, opts: NormalizeReprOptions = {}): string {
  return text.replace(DICT_RE, (dict, offset: number, whole: string) => {
    const pairs = parsePairs(dict);
    if (pairs === null) return dict;
    // Үүрлэсэн dict-ийн ДОТООД утга (`{'foo': {'a': 1}}`) — гаднах нь repr хэвээр тул
    // хөндөхгүй; `hasPythonRepr` бүхэлд нь барина.
    if (/'[A-Za-z_][A-Za-z0-9_]*'\s*:\s*$/.test(whole.slice(0, offset))) return dict;
    const allComparator = pairs.every((p) => COMPARATOR_KEYS.has(p.key));
    if (allComparator) {
      const rendered = renderComparator(pairs);
      if (rendered === null) return dict;
      // «g = > 2200» гэж давхар тэмдэг гаргахгүй: өмнөх «=»-ийг харьцуулагчид шингээнэ.
      const before = whole.slice(0, offset);
      const eq = /\s*=\s*$/.exec(before);
      if (eq !== null && /^[><≥≤=]/.test(rendered)) {
        return `\u0000${rendered}`; // тэмдэглэгээ — доор `= \0>` → `>` болгоно
      }
      return rendered;
    }
    const rendered = renderVariants(pairs, opts.percentVariants === true);
    // «хувилбарууд {…}» → «хувилбарууд: …»; өмнө нь аль хэдийн «:» байвал давхардуулахгүй.
    return /:\s*$/.test(whole.slice(0, offset)) ? rendered : `\u0001${rendered}`;
  })
    .replace(/\s*\u0001/g, ': ')
    .replace(/\s*=\s*\u0000/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;.])/g, '$1');
}
