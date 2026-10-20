/**
 * MGL AI · ДАВТАЛТЫН ИЛРҮҮЛЭГЧ — ЦЭВЭР ФУНКЦ.
 *
 * ⚠️ ЮУГ БАРИХ ЁСТОЙ ВЭ: «загвар нэг хэллэгийг ТАСРАЛТГҮЙ давтсаар
 *    зогсохгүй байх» гэсэн ГАЖИГ.  Жишээ нь «…шаардлагатай байна.
 *    шаардлагатай байна. шаардлагатай байна. …» гэж max_tokens
 *    дуустал үргэлжлэх.
 *
 * ⚠️ ЮУГ БАРИХ ЁСГҮЙ ВЭ (ЭНЭ НЬ ИЛҮҮ ЧУХАЛ): ХУУЛЬ ЁСНЫ давталт.
 *    Техникийн монгол хариулт нь «БНбД», «заалт», «шаардлагатай» гэсэн
 *    үгсийг олон удаа хэлнэ; хүснэгтийн зураас `| --- | --- |`, жагсаалтын
 *    `- ` угтвар, кодын хаалт бүгд давтагдана.  Тэднийг барих нь ЗӨВ
 *    хариултыг унагаана — тэр нь анхны алдаанаас ДОР.
 *
 *    Тиймээс дүрэм нь: ЗӨВХӨН ЗЭРЭГЦЭЭ (adjacent) МӨЧЛӨГ.  Өөрөөр хэлбэл
 *    сүүлийн N үг нь ЯГ ижил блокуудаас бүтсэн байх ёстой.  Тархай
 *    давтагдсан үг нь ХЭЗЭЭ Ч баригдахгүй.
 *
 * ⚠️ ХИЛЭЭР ХАМГААЛАГДСАН.  Зөвхөн сүүлийн `WINDOW_WORDS` үгийг хардаг
 *    тул санах ой ба CPU нь хариултын уртаас ХАМААРАХГҮЙ (O(1) санах ой,
 *    дуудлага бүрд O(WINDOW_WORDS × MAX_CYCLE)).  Урсгалын явцад токен
 *    бүрд дуудахад аюулгүй.
 *
 * ⚠️ КИРИЛЛИЙГ ЗААВАЛ ДЭМЖИНЭ.  Үг таслахдаа `\p{L}\p{N}` (Unicode)
 *    ашиглана — ASCII `\w` нь кирилл үсгийг үг гэж үздэггүй тул монгол
 *    бичвэр дээр илрүүлэгч ЧИМЭЭГҮЙ ажиллахаа болино.
 */

/** Хэдэн үгийн сүүлийг харах вэ.  Мөчлөгийн дээд урт × давталтын дээд тоо. */
const WINDOW_WORDS = 160;
/** Мөчлөгийн дээд урт (үгээр).  Үүнээс урт давталт нь ховор, бас үнэтэй. */
const MAX_CYCLE_WORDS = 12;

export interface RepetitionOptions {
  /**
   * Богино мөчлөг (1-2 үг) хэдэн удаа давтагдвал гажиг гэж үзэх вэ.
   *
   * ⚠️ ӨНДӨР БАЙХ ЁСТОЙ.  «маш маш их», «дахин дахин» гэх мэт монгол
   *    чангатгал нь 2-3 удаа давтагддаг — тэднийг барих нь худал эерэг.
   */
  shortCycleRepeats?: number;
  /** Урт мөчлөг (3+ үг) хэдэн удаа давтагдвал гажиг гэж үзэх вэ. */
  longCycleRepeats?: number;
  /**
   * Давтагдсан хэсэг нийт хэдэн тэмдэгтээс урт байх ёстой вэ.
   *
   * ⚠️ Богино дуу чимээ (жишээ нь «. . . .») барихаас сэргийлнэ.
   */
  minSpanChars?: number;
}

export interface RepetitionVerdict {
  repeating: boolean;
  /** Давтагдаж буй хэллэг — оношилгоонд.  ⚠️ Бүтэн хариултыг БУЦААХГҮЙ. */
  phrase: string;
  /** Хэдэн удаа зэрэгцээ давтагдсан. */
  repeats: number;
  /** Мөчлөгийн урт, үгээр. */
  cycleWords: number;
}

const NO: RepetitionVerdict = { repeating: false, phrase: '', repeats: 0, cycleWords: 0 };

/**
 * Үг таслах.
 *
 * ⚠️ ЦЭГ, ТАСЛАЛЫГ ХАЯХГҮЙ, харин үгэнд НААЛДУУЛНА.  «шаардлагатай.» ба
 *    «шаардлагатай» нь өөр — эхнийх нь өгүүлбэрийн төгсгөл.  Цэг таслалыг
 *    хаявал жагсаалтын мөрүүд («1. Нэг», «2. Нэг») ижил харагдаж, худал
 *    эерэг өгнө.
 */
function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Мөр нь утга агуулж байна уу (үсэг эсвэл тоо).
 *
 * ⚠️ ЗӨВХӨН ЦЭГ ТАСЛАЛААС БҮРДСЭН МӨЧЛӨГИЙГ ХЭЗЭЭ Ч БАРИХГҮЙ.  Markdown
 *    хүснэгтийн `| --- | --- | --- |`, тусгаарлагч `— — —`, кодын
 *    `}) }) })` бүгд хууль ёсны бөгөөд яг ийм хэлбэртэй байдаг.
 */
function hasContent(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * Хариултын СҮҮЛ нь зэрэгцээ давтагдсан мөчлөгөөр төгсөж байгаа эсэх.
 *
 * Алгоритм: мөчлөгийн урт `p`-г 1..MAX_CYCLE_WORDS хүртэл нэмэгдүүлж,
 * сүүлийн `k × p` үг нь ЯГ ижил `k` блок мөн эсэхийг шалгана.  Хамгийн
 * БОГИНО мөчлөгийг эхэлж олохын тулд `p`-г өсөх дарааллаар үзнэ — «а б а б
 * а б» нь 1-үгийн биш, 2-үгийн мөчлөг.
 */
export function detectRepetition(
  text: string,
  opts: RepetitionOptions = {},
): RepetitionVerdict {
  const shortRepeats = opts.shortCycleRepeats ?? 6;
  const longRepeats = opts.longCycleRepeats ?? 3;
  const minSpanChars = opts.minSpanChars ?? 24;

  const all = words(text);
  if (all.length < 4) return NO;
  // ⚠️ ЦОНХ — санах ой, CPU-г хариултын уртаас ТУСГААРЛАНА.
  const w = all.length > WINDOW_WORDS ? all.slice(all.length - WINDOW_WORDS) : all;

  for (let p = 1; p <= MAX_CYCLE_WORDS; p++) {
    const need = p === 1 || p === 2 ? shortRepeats : longRepeats;
    if (w.length < p * need) break;

    // Сүүлээс эхлээд хэдэн блок ИЖИЛ байгааг тоолно.
    let repeats = 1;
    for (;;) {
      const endA = w.length - repeats * p;
      const startA = endA - p;
      if (startA < 0) break;
      let same = true;
      for (let i = 0; i < p; i++) {
        if (w[startA + i] !== w[endA + i]) {
          same = false;
          break;
        }
      }
      if (!same) break;
      repeats += 1;
    }

    if (repeats < need) continue;

    const phrase = w.slice(w.length - p).join(' ');
    if (!hasContent(phrase)) continue; // цэг таслалын мөчлөг — хууль ёсны
    const spanChars = phrase.length * repeats;
    if (spanChars < minSpanChars) continue;

    return { repeating: true, phrase, repeats, cycleWords: p };
  }

  return NO;
}

/**
 * УРСГАЛЫН ИЛРҮҮЛЭГЧ — токен тутам дуудахад зориулагдсан.
 *
 * ⚠️ ХИЛЭЭР ХАМГААЛАГДСАН ХОЁР ТАЛААС: (1) зөвхөн сүүлийн `TAIL_CHARS`
 *    тэмдэгтийг хадгална тул урт хариулт дээр санах ой ӨСӨХГҮЙ;
 *    (2) `CHECK_EVERY_CHARS` тэмдэгт тутамд Л шалгана тул токен бүрд
 *    бүтэн скан хийхгүй.
 *
 * ⚠️ ХЭСГИЙН ХИЛИЙГ ӨӨРӨӨ ЗОХИЦУУЛНА.  Урсгалын хэсэг нь үгийн дундуур
 *    тасарч болно; бид ТЕКСТИЙГ хуримтлуулаад дүн шинжилгээ хийдэг тул
 *    хилийн асуудал байхгүй.
 */
export class StreamingRepetitionGuard {
  /** Сүүлийн хэдэн тэмдэгтийг барих — цонхны 160 үгийг багтаана. */
  static readonly TAIL_CHARS = 2000;
  /** Хэдэн шинэ тэмдэгт ирэх бүрд шалгах вэ. */
  static readonly CHECK_EVERY_CHARS = 48;

  #tail = '';
  #sinceCheck = 0;
  #verdict: RepetitionVerdict = NO;
  readonly #opts: RepetitionOptions;

  constructor(opts: RepetitionOptions = {}) {
    this.#opts = opts;
  }

  /** Шинэ хэсэг нэмээд, гажиг илэрсэн эсэхийг буцаана. */
  push(chunk: string): RepetitionVerdict {
    if (this.#verdict.repeating) return this.#verdict;
    this.#tail += chunk;
    if (this.#tail.length > StreamingRepetitionGuard.TAIL_CHARS) {
      this.#tail = this.#tail.slice(this.#tail.length - StreamingRepetitionGuard.TAIL_CHARS);
    }
    this.#sinceCheck += chunk.length;
    if (this.#sinceCheck < StreamingRepetitionGuard.CHECK_EVERY_CHARS) return NO;
    this.#sinceCheck = 0;
    const v = detectRepetition(this.#tail, this.#opts);
    if (v.repeating) this.#verdict = v;
    return v;
  }

  /** Урсгал дууссаны дараах эцсийн шалгалт — богино хариултыг барина. */
  finish(): RepetitionVerdict {
    if (this.#verdict.repeating) return this.#verdict;
    const v = detectRepetition(this.#tail, this.#opts);
    if (v.repeating) this.#verdict = v;
    return v;
  }

  get verdict(): RepetitionVerdict {
    return this.#verdict;
  }
}
