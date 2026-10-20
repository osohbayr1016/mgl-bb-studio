/**
 * `/media/<key>` — НЭГ СЕГМЕНТ.  Уншилт ба бичилтийн ЦОРЫН ГАНЦ эх сурвалж.
 *
 * ⚠️ ЯАГААД ЗАДАЛСАН УТГА ДЭЭР ШАЛГАХ ЁСТОЙ ВЭ:
 * Hono 4.12.14 нь `decodeURI` хийсэн зам дээр route-даг (`decodeURI` нь
 * `%2F`-ыг ЗАДАЛДАГГҮЙ) атлаа `c.req.param()` нь дараа нь бүрэн
 * `decodeURIComponent` хийдэг.  Тиймээс `/media/email%2F5%2Fx%2Fbody.html`
 * нь `GET /:key`-д ТААРААД `key = 'email/5/x/body.html'` болно (`%2f`
 * жижиг үсгээр ч ижил).  Хэмжсэн (2026-08-27, `backend/`-ээс локал Hono):
 *
 *     /media/email%2F5%2Fx%2Fbody.html  →  STATUS 200  PARAM= email/5/x/body.html
 *     /media/email/5/x/body.html        →  STATUS 404   (route таарахгүй)
 *
 * Өөрөөр хэлбэл «route нь ЯГ нэг сегмент тул хавтастай түлхүүр хэзээ ч
 * уншигдахгүй» гэсэн, кодын хэдэн газарт давтагдсан үндэслэл ХУДАЛ.  Түүн
 * дээр тулгуурлан `email/…` (и-мэйлийн бие ба хавсралт — REST талдаа
 * `requireAdmin()`) болон `revit-addin/…zip` (эзэмшигчид зориулсан
 * суулгагч, энтропи ТЭГ) зэрэг угтвар дор байгаа объектууд БҮГД
 * баталгаажуулалтгүй уншигдаж байсан.
 *
 * Мөн `lib/clientReportRender.ts:131` нь D1-д хадгалсан утган дээр ӨӨРӨӨ
 * `decodeURIComponent` хийж R2 руу ШУУД ханддаг — HTTP hop БАЙХГҮЙ тул
 * `routes/media.ts`-ийн шалгалт тэр зам дээр ХЭЗЭЭ Ч ажиллахгүй.  Иймээс
 * уншилтын хаалт ганцаараа ХАНГАЛТГҮЙ: бичих талыг ЗААВАЛ хамт хаана.
 *
 * ДҮГНЭЛТ: шалгалт нь ЗААВАЛ ЗАДАЛСНЫ ДАРАА `/` эсэхийг үзнэ — түүхий
 * мөрөнд `/` байхгүй нь юу ч батлахгүй.
 */

/**
 * Давхар кодлолтын задлалтын дээд тоо.
 *
 * Яагаад 1 биш вэ (`docs/bim-ai/1A-1-media-traversal.md` §9 №6-ийн шийдвэр):
 * өнөөдөр `%252F` нь 404 өгдөг (Hono нэг л удаа задалдаг) тул зайлшгүй биш.
 * Гэхдээ ирээдүйд ямар нэг зам НЭМЭЛТ задлалт хийвэл нүх дахин нээгдэнэ —
 * жишээ нь `clientReportRender.ts` нь Hono-гоос ХАРААТ БУСААР дахин
 * задалдаг.  Тогтвортой цэг хүртэл задлах нь тэр ангиллын бүх хувилбарыг
 * нэг дор хаана.  Хууль ёсны түлхүүр `%`-ыг ОГТ агуулдаггүй тул
 * (`upload.ts:33, 136` ба `email.ts:917` хоёулаа `[^a-zA-Z0-9.-]` → `_`)
 * энэ хатуулаг нэг ч бодит уншилтыг эвдэхгүй.
 */
const MAX_DECODE_PASSES = 3;

/** R2 түлхүүр нэг сегмент мөн эсэх.  ЗАДАЛСНЫ ДАРАА шалгана. */
export function isSingleSegmentKey(key: string): boolean {
  if (key.length === 0) return false;
  let decoded = key;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false; // гэмтсэн хувь (`%zz`) — татгалзана
    }
    if (next === decoded) break;
    decoded = next;
  }
  // `\` нь зарим клиент/файлын систем дээр зам тусгаарлагч, `\0` нь
  // мөр таслах заль — хоёулаа хориотой.
  return !decoded.includes('/') && !decoded.includes('\u005C') && !decoded.includes('\0');
}

/** `/media/<нэг сегмент>` хэлбэрийн URL мөн эсэх (бичих талын хаалт). */
export function isSingleSegmentMediaUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!v.startsWith('/media/')) return false;
  return isSingleSegmentKey(v.slice('/media/'.length));
}
