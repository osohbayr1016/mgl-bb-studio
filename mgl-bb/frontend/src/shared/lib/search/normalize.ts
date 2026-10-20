/**
 * Хайлтын текстийг НЭГ хэлбэрт буулгах (fold) — `backend/src/lib/textFold.ts`-ийн
 * БАЙНГЫН ХОСЛОЛ (twin).
 *
 * ⚠️ ХОЁУЛАНГ НЬ ЗЭРЭГ ӨӨРЧИЛНӨ.  Дүрэм зөрвөл вэб дээрх хайлт болон
 * Revit хуудасны таарц өөр өөр хариу өгнө.  `backend/src/lib/textFold.test.ts`
 * дэх корпус нь хоёр талын ГЭРЭЭ — энэ файлыг өөрчилвөл тэр корпусыг мөн
 * шинэчил.
 *
 * ⚠️ ХОСЛОЛЫН БҮРЭН ЖАГСААЛТ (энэ файл ↔ `backend/src/lib/textFold.ts`):
 * `foldSearchText` ↔ `foldText`,  `foldSearchCode` ↔ `foldCode`,
 * `foldCodeVariants` ↔ `foldCodeVariants` (байт дарааллаараа ижил).
 *
 * Асуудал: хэрэглэгч «Илүү цаг»-ийг дор хаяж дөрвөн янзаар бичнэ —
 * `илүү цаг`, `iluu tsag`, `ilu cag`, `iluu cag`.  Урьд нь хайлт нь
 * `toLowerCase().includes()` байсан тул зөвхөн ЭХНИЙХ нь ажилладаг байв.
 *
 * Шийдэл: хайлтын мөр БА индексийн мөр ХОЁУЛАНГ нь яг ижил дүрмээр
 * латин руу буулгаад жижиг зөрүүг арилгана.  Дүрмүүд нь ХОЁР ТАЛД
 * ижилхэн хэрэглэгддэг тул «алдаатай» хөрвүүлэлт ч гэсэн таарцыг
 * эвддэггүй — зөвхөн ялгааг арилгадаг.
 *
 * Дүрмийн дараалал (бүгд ХОЁР талд):
 *   1. жижиг үсэг + латин диакритик арилгах  (é → e)
 *   2. кирилл → латин                        (ц → ts, ө → o, ү → u)
 *   3. `kh` → `h`     — латинаар бичсэн «х» (khoshigtiin → hoshigtiin)
 *   4. `ts` → `c`     — «цаг» ← `tsag` эсвэл `cag`
 *   5. `y`  → `i`     — «й/ы» ← `y` эсвэл `i` (taylan → tailan)
 *   6. үсэг бус тэмдэг → зай  (`MGL-260101_Хөшиг` → `mgl 260101 hoshig`)
 *   7. давхардсан ҮСЭГ хураах  (iluu → ilu, hoshigtiin → hoshigtin)
 *      ⚠️ Зөвхөн үсэг: `1200` → `120` болвол дугаараар хайх боломжгүй болно.
 *
 * ⚠️ `о`/`ө` хоёр ХОЁУЛАА `o`, `у`/`ү` хоёр ХОЁУЛАА `u` болно — санаатай.
 * Хэрэглэгч ө/ү-г латин гараас бичихдээ o/u дардаг бөгөөд кирилл бичихдээ ч
 * андуурдаг.  Ялгааг хадгалахаас илүү таарц чухал.
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Хайлтын харьцуулалтын хэлбэр.  Хоосон мөр буцаж болно. */
export function foldSearchText(input: string): string {
  if (!input) return '';

  const lowered = input
    .toLowerCase()
    // Латин диакритик (é, ü, ñ …) — суурь үсэг рүү.  Кириллд нөлөөгүй.
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  let out = '';
  for (const ch of lowered) out += CYRILLIC_TO_LATIN[ch] ?? ch;

  return out
    .replace(/kh/g, 'h')
    .replace(/ts/g, 'c')
    .replace(/y/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    // Давхар ҮСЭГ хураах — тоог хөндөхгүй.
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}

/** Хайлтын мөрийг үгсэд хуваана — үг БҮР таарах ёстой (AND). */
export function foldSearchTokens(query: string): string[] {
  const folded = foldSearchText(query);
  return folded ? folded.split(' ') : [];
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
export function foldSearchCode(input: string): string {
  return foldSearchText(input).replace(/ /g, '');
}

/*
 * ═══════════════ ГЛИФ (харагдах хэлбэр) ФОЛД — ЗӨВХӨН ШИФРТ ═══════════════
 *
 * ⚠️ ХЭМЖИГДСЭН АЛДАА: продакшнд нэг л шифр хоёр бичлэгтэй байдаг —
 * латинаар «MEC-25/21», монгол гараас «МЕС-25/21».  Фонетик дүрмээр
 * латин `c` нь `c`, кирилл «с» нь `s` тул `foldSearchCode` эдгээрийг
 * 'mec2521' ба 'mes2521' болгож ХЭЗЭЭ Ч таарахгүй.  Төсөл 36 нь
 * кириллээр («МЕС24/08»), төсөл 37/41 нь латинаар бичигдсэн.
 *
 * ⚠️ ЯАГААД `foldSearchText`-д «с → c» НЭМЖ БОЛОХГҮЙ вэ: «ц» аль хэдийн `c`
 * болдог тул «сар»/«цар» нэг болж, ДӨРВӨН хос файл (backend-ийн
 * teamContext.ts, revitMatch.ts, rulePack.ts болон энэ хайлт) чимээгүй
 * эвдэрнэ.  Тиймээс `foldSearchText`/`foldSearchCode` НЭГ Ч БАЙТААР
 * өөрчлөгдөөгүй — доорх нь тэдгээрийн ХАЖУУД нэмэгдсэн ГУРАВ ДАХЬ функц.
 *
 * ⚠️ ЗӨВХӨН КОДЫН ТАЛБАРТ (drawing_no, doc_no, шифр, хуудасны дугаар).
 * Чөлөөт текстэд хэрэглэвэл «ХАС» → 'xac' болж багийн кодыг ГЭМТЭЭНЭ,
 * «нохой» → 'hohoi' болж утгагүй болно.
 */

/** Кирилл → ХАРАГДАЦААР ижил латин үсэг.  Бусад үсэг фонетик хэвээрээ. */
const CYRILLIC_GLYPH_TO_LATIN: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
};

/** Глиф давамгайлсан хүснэгт — үлдсэн үсэгт фонетик дүрэм үйлчилнэ. */
const CODE_GLYPH_MAP: Record<string, string> = {
  ...CYRILLIC_TO_LATIN,
  ...CYRILLIC_GLYPH_TO_LATIN,
};

/**
 * `foldSearchCode`-той ЯГ ИЖИЛ дараалал, гагцхүү кирилл→латин хүснэгт нь глиф.
 * ⚠️ Давхардсан код биш — `foldSearchText`-ийг өөрчлөхгүй байх шаардлагын үнэ.
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
  for (const variant of [foldSearchCode(input), foldCodeGlyph(input)]) {
    if (variant && !out.includes(variant)) out.push(variant);
  }
  return out;
}
