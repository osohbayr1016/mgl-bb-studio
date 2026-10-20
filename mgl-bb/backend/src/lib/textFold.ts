/**
 * Кирилл↔латин НЭГ хэлбэрт буулгах (fold) — `frontend/src/shared/lib/search/
 * normalize.ts`-ийн `foldSearchText`-ийн БАЙНГЫН ХОСЛОЛ (twin).
 *
 * ⚠️ ХОЁУЛАНГ НЬ ЗЭРЭГ ӨӨРЧИЛНӨ.  Дүрэм зөрвөл вэб дээрх хайлт болон
 * Revit хуудасны таарц өөр өөр хариу өгнө.  `textFold.test.ts` дэх корпус
 * нь хоёр талын гэрээ — frontend-ийг өөрчилвөл тэр корпусыг мөн шинэчил.
 *
 * ⚠️ ХОСЛОЛЫН БҮРЭН ЖАГСААЛТ (энэ файл ↔ `frontend/src/shared/lib/search/
 * normalize.ts`):  `foldText` ↔ `foldSearchText`,  `foldCode` ↔ `foldSearchCode`,
 * `foldCodeVariants` ↔ `foldCodeVariants` (байт дарааллаараа ижил).
 *
 * ⚠️ ЯАГААД `qtoNormalize.ts`-ийн `normalizeRawName`-ийг АШИГЛАЖ БОЛОХГҮЙ вэ:
 * тэр нь ган хийцийн тэмдэглэгээнд зориулагдсан бөгөөд `[х×*] → x` фолд
 * хийдэг.  Кирилл «х» бол үржүүлэхийн тэмдэг БИШ, жинхэнэ үсэг —
 * «халаалт» → «xалаалт», «ХАС-01» → «xac01» болж МОНГОЛ ҮГИЙГ ГЭМТЭЭНЭ.
 * `normalizeRawName`-ийг зөвхөн resource_alias-д үлдээ.
 *
 * Дүрмийн дараалал (frontend-тэй ЯГ ИЖИЛ):
 *   1. жижиг үсэг + латин диакритик арилгах  (é → e)
 *   2. кирилл → латин                        (ц → ts, ө → o, ү → u, х → h)
 *   3. `kh` → `h`     — латинаар бичсэн «х»
 *   4. `ts` → `c`     — «цаг» ← `tsag` эсвэл `cag`
 *   5. `y`  → `i`     — «й/ы» ← `y` эсвэл `i`
 *   6. үсэг бус тэмдэг → зай
 *   7. давхардсан ҮСЭГ хураах  (⚠️ зөвхөн үсэг — `1200` → `120` болвол
 *      дугаараар хайх боломжгүй болно)
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j',
  з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Харьцуулалтын хэлбэр — үгсийн хооронд НЭГ зайтай.  Хоосон мөр буцаж болно. */
export function foldText(input: string): string {
  if (!input) return '';

  const lowered = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  let out = '';
  for (const ch of lowered) out += CYRILLIC_TO_LATIN[ch] ?? ch;

  return out
    .replace(/kh/g, 'h')
    .replace(/ts/g, 'c')
    .replace(/y/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}

/**
 * ШИФР-ийн хэлбэр — зайг бүрэн хасна.  Зөвхөн ХУУДАСНЫ ДУГААР / ЗУРГИЙН
 * ШИФР зэрэг богино кодод.  Чөлөөт тексттэй хэзээ ч бүү харьцуул —
 * «1-р давхрын план» ба «1р давхрын план» ялгаагүй болчихно.
 *
 *   'БА-01'   → 'ba01'
 *   'BA 01'   → 'ba01'
 *   'ХАС-01'  → 'has01'
 *   'HAS_01'  → 'has01'
 */
export function foldCode(input: string): string {
  return foldText(input).replace(/ /g, '');
}

/*
 * ═══════════════ ГЛИФ (харагдах хэлбэр) ФОЛД — ЗӨВХӨН ШИФРТ ═══════════════
 *
 * ⚠️ ХЭМЖИГДСЭН АЛДАА: продакшнд нэг л шифр хоёр бичлэгтэй байдаг —
 * латинаар «MEC-25/21», монгол гараас «МЕС-25/21».  Фонетик дүрмээр
 * латин `c` нь `c`, кирилл «с» нь `s` тул `foldCode` эдгээрийг
 * 'mec2521' ба 'mes2521' болгож ХЭЗЭЭ Ч таарахгүй.  Төсөл 36 нь
 * кириллээр («МЕС24/08»), төсөл 37/41 нь латинаар бичигдсэн.
 *
 * ⚠️ ЯАГААД `foldText`-д «с → c» НЭМЖ БОЛОХГҮЙ вэ: «ц» аль хэдийн `c`
 * болдог тул «сар»/«цар» нэг болж, ДӨРВӨН хос файл (teamContext.ts,
 * revitMatch.ts, rulePack.ts, frontend-ийн хайлт) чимээгүй эвдэрнэ.
 * Тиймээс `foldText`/`foldCode` НЭГ Ч БАЙТААР өөрчлөгдөөгүй — доорх нь
 * тэдгээрийн ХАЖУУД нэмэгдсэн ГУРАВ ДАХЬ функц.
 *
 * ⚠️ ЗӨВХӨН КОДЫН ТАЛБАРТ (drawing_no, doc_no, шифр, хуудасны дугаар).
 * Чөлөөт текстэд хэрэглэвэл «ХАС» → 'xac' болж багийн кодыг ГЭМТЭЭНЭ,
 * «нохой» → 'hohoi' болж утгагүй болно.
 */

/** Кирилл → ХАРАГДАЦААР ижил латин үсэг.  Бусад үсэг фонетик хэвээрээ. */
const CYRILLIC_GLYPH_TO_LATIN: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o',
  р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};

/** Глиф давамгайлсан хүснэгт — үлдсэн үсэгт фонетик дүрэм үйлчилнэ. */
const CODE_GLYPH_MAP: Record<string, string> = {
  ...CYRILLIC_TO_LATIN,
  ...CYRILLIC_GLYPH_TO_LATIN,
};

/**
 * `foldCode`-той ЯГ ИЖИЛ дараалал, гагцхүү кирилл→латин хүснэгт нь глиф.
 * ⚠️ Давхардсан код биш — `foldText`-ийг өөрчлөхгүй байх шаардлагын үнэ.
 */
function foldCodeGlyph(input: string): string {
  if (!input) return '';

  const lowered = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  let out = '';
  for (const ch of lowered) out += CODE_GLYPH_MAP[ch] ?? ch;

  return out
    .replace(/kh/g, 'h')
    .replace(/ts/g, 'c')
    .replace(/y/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .trim()
    .replace(/ /g, '');
}

/**
 * Нэг шифрийн БҮХ харьцуулах хэлбэр — [фонетик, глиф], давхардлыг хассан.
 *
 * ⚠️ ХОЁР ТАЛД НЬ дуудна: хадгалагдсан шифр дээр БОЛОН хэрэглэгчийн бичсэн
 * мөр дээр.  Таарц гэдэг нь хоёр ОЛОНЛОГ ОГТЛОЛЦОХ явдал.  Зөвхөн индексийн
 * талд гаргавал хангалтгүй: «MEC-25/21» аль хэдийн латин тул түүний олонлог
 * {mec2521} ганцаараа бөгөөд кириллээр бичсэн хайлт нь 'mes2521' хэвээр
 * үлдэж таарахгүй.
 *
 *   foldCodeVariants('MEC-25/21') → ['mec2521']
 *   foldCodeVariants('МЕС-25/21') → ['mes2521', 'mec2521']   ← огтлолцоно
 *   foldCodeVariants('ХАС-01')    → ['has01', 'xac01']
 *   foldCodeVariants('')          → []
 */
export function foldCodeVariants(input: string): string[] {
  const out: string[] = [];
  for (const variant of [foldCode(input), foldCodeGlyph(input)]) {
    if (variant && !out.includes(variant)) out.push(variant);
  }
  return out;
}
