/**
 * v2 §80 — ҮЙЛДВЭРЛЭЛИЙН ЭРХИЙН ТҮВШИН (`bim.compliance.authority_level`).
 *
 * `0230_compliance_authority.sql` нь `app_settings`-д '0'..'5' ТЭМДЭГТ МӨР
 * хадгална.  Энэ файл нь тэр мөрийг НЭРТЭЙ түвшин ба ТУСГААРЛАГДСАН
 * ЭРХҮҮД болгож буулгах ЦОРЫН ГАНЦ газар.
 *
 * ⚠️ ЯАГААД ТУСДАА ФАЙЛ ВЭ (2026-08-31).  `2-5-finding-surface` §3.1 нь эдгээр
 *    тогтмолуудыг `lib/complianceModel.ts`-д байрлуулна гэж заасан боловч тэр
 *    файлыг `2-2-rule-model` ЗЭРЭГ бичиж байгаа тул хөндөх нь түүний ажлыг
 *    дарж бичнэ.  Тиймээс эрхийн давхарга нь ӨӨРИЙН файлтай гарлаа.
 *    ⚠️ ХАНДАЛТ `2-5` ХИЙХДЭЭ: `complianceModel.ts` нь ЭНЭ файлаас
 *    RE-EXPORT хийнэ, ХУУЛБАРЛАХГҮЙ.  Хоёр `AUTHORITY_CAPS` орших нь
 *    хоёр өөр бодлого болж, `surface` нэг талдаа true, нөгөө талдаа false
 *    болох өдөр л илэрнэ.
 *
 * ⚠️ ЭНЭ ФАЙЛД ХАМААРАЛ БАЙХГҮЙ — цэвэр тогтмол ба цэвэр функц.  D1, Hono,
 *    Env, `Autodesk` ямар ч төрөл ОРОХГҮЙ.  Тэгснээр `node --test` доор
 *    шууд ачаалагдана.
 */

/** v2:2524-2529-ийн зургаан түвшин, БАЙТ БАЙТААР, ДАРААЛАЛ НЬ ЗЭРЭГЛЭЛ. */
export const AUTHORITY_LEVELS = [
  'OBSERVE', // 0
  'EXPLAIN', // 1
  'RECOMMEND', // 2
  'PREVIEW', // 3
  'HUMAN_APPROVED_EXECUTE', // 4
  'LIMITED_AUTONOMOUS_EXECUTE', // 5
] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

/** `AUTHORITY_LEVELS`-ийн индекс — `app_settings`-д ЯГ ЭНЭ тоо мөр болж хадгалагдана. */
export type AuthorityIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface AuthorityCaps {
  /** Дүгнэлтийг ЦУГЛУУЛЖ, хадгалж болох уу. */
  collect: boolean;
  /** Инженерт ХАРУУЛЖ болох уу. */
  surface: boolean;
  /** ЯАГААД гэдгийг тайлбарлаж болох уу (заалт, тооцоо). */
  explain: boolean;
  /** ЗАСВАРЫГ САНАЛ болгож болох уу (текстээр). */
  recommend: boolean;
  /** Урьдчилан харах өөрчлөлт БЭЛТГЭЖ болох уу. */
  preview: boolean;
  /** Загварыг БИЧИЖ болох уу. */
  write: boolean;
}

/**
 * ⚠️ TOTAL Record — шинэ түвшин нэмэх нь КОМПИЛЯЦИЙН АЛДАА.
 * ⚠️ `write` нь ЗӨВХӨН 4/5-д true — релиз N-д ХҮРЭХГҮЙ.
 * ⚠️ LEVEL 0 (OBSERVE) нь `surface: false` — DLL нь бүрэн хөдөлгүүрийг
 *    агуулна, дүгнэлт хадгалагдана, гэвч ribbon-ийн тоолуур ХАРАНХУЙ.
 *    Эзэн эхний релиз дээр badge хайвал ЗӨВ систем эвдэрсэн мэт харагдана —
 *    `2-0-OWNER-BRIEF` §3.2 ба `2-4` §3.16 хоёулаа ижил утгаар давтсан.
 */
export const AUTHORITY_CAPS: Record<AuthorityLevel, AuthorityCaps> = {
  OBSERVE: { collect: true, surface: false, explain: false, recommend: false, preview: false, write: false },
  EXPLAIN: { collect: true, surface: true, explain: true, recommend: false, preview: false, write: false },
  RECOMMEND: { collect: true, surface: true, explain: true, recommend: true, preview: false, write: false },
  PREVIEW: { collect: true, surface: true, explain: true, recommend: true, preview: true, write: false },
  HUMAN_APPROVED_EXECUTE: { collect: true, surface: true, explain: true, recommend: true, preview: true, write: true },
  LIMITED_AUTONOMOUS_EXECUTE: { collect: true, surface: true, explain: true, recommend: true, preview: true, write: true },
};

/**
 * `app_settings['bim.compliance.authority_level']` → 0..5 индекс.
 *
 * ⚠️ ТАНИХГҮЙ / ХООСОН / ГЭМТЭЛТЭЙ утга ҮРГЭЛЖ ХАМГИЙН БАГА эрх рүү унана.
 *    Мөр байхгүй (`null`), '', 'abc', '9', '-1', '1.5', ' ' — БҮГД 0.
 *    Энэ бол аюулгүй унал: тохиргоо гэмтсэн үед систем БИЧИХГҮЙ, ХАРУУЛАХГҮЙ,
 *    зөвхөн ажиглана.
 * ⚠️ `Number('')` нь 0 болдог тул ХООСОН мөрийг ТУСГАЙЛАН барина — эс бөгөөс
 *    «утга байхгүй» ба «зориудаар LEVEL 0» хоёр ялгагдахгүй байх нь асуудал
 *    биш ч, `' '` мэт хог утга ч 0 болохыг ил тод байлгах нь дээр.
 */
export function authorityIndexFromSetting(raw: string | null | undefined): AuthorityIndex {
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  // ⚠️ ЗӨВХӨН АРВАН ТООЛЛЫН ЦЭВЭР ЦИФР.  `Number()`-ыг ГАНЦААРАА
  //    хэрэглэвэл '0x2' нь 2 (RECOMMEND), '1e0' нь 1
  //    болно — өөрөөр хэлбэл D1 дээрх хог утга add-in-ы эрхийг ЧИМЭЭГҮЙ
  //    ӨСГӨЖ чадна.  Эрхийг өсгөх ЦОРЫН ГАНЦ зам нь ил тод '1'..'5'.
  if (!/^[0-9]+$/.test(trimmed)) return 0;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n >= AUTHORITY_LEVELS.length) return 0;
  return n as AuthorityIndex;
}

/** `app_settings['bim.compliance.authority_level']` → нэртэй түвшин.  NULL ⇒ OBSERVE. */
export function authorityFromSetting(raw: string | null | undefined): AuthorityLevel {
  return AUTHORITY_LEVELS[authorityIndexFromSetting(raw)];
}

/** Тухайн түвшний эрхүүд.  ⚠️ Уншигч бүр ЭНЭ функцээр орно, `caps.surface`-ыг өөрөө бодохгүй. */
export function authorityCaps(level: AuthorityLevel): AuthorityCaps {
  return AUTHORITY_CAPS[level];
}
