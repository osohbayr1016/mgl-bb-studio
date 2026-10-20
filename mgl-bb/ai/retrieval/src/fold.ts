/**
 * MGL AI · КИРИЛЛ↔ЛАТИН ФОЛД.
 *
 * ⚠️ ЭНЭ НЬ `backend/src/lib/textFold.ts`-ийн `foldText`-ИЙН ЗОРИУДЫН ХУВИЛБАР.
 *    Хуулбарласан шалтгаан: `ai/` нь тусдаа npm ажлын талбар, тусдаа
 *    tsconfig — `backend/src`-ээс импортлох нь хоёр багцыг холбоно.  Тэр нь
 *    ажилтны PC дээрх локал runtime-ыг ERP-ийн build-аас хамааралтай болгоно.
 *
 * ⚠️ ХОЁУЛАНГ НЬ ЗЭРЭГ ӨӨРЧИЛНӨ.  `test/fold.test.ts` нь хоёр талын гэрээг
 *    барина — зөрвөл вэб дээрх хайлт ба локал хайлт өөр хариу өгнө.
 *
 * ⚠️ ЯАГААД ЭНЭ ФОЛД НЬ ЯГ ЭНЭ БАГЦАД ТААРАВ.  Багцын `text_latin` нь
 *    BGN/PCGN маягийн галиг («Хавсралтад» → «Khavsraltad»).  `foldText` нь
 *    `kh → h` дүрэмтэй тул кирилл эх ба латин галиг НЭГ мөр рүү нийлнэ:
 *      foldText('Хавсралтад')  === 'havsraltad'
 *      foldText('Khavsraltad') === 'havsraltad'
 *    Тиймээс латинаар бичсэн асуулт нь кирилл индексийг ОЛНО.  Энэ нь
 *    санамсаргүй давхцал БИШ — `qa_retrieval_tests.jsonl`-ийн 112 mn-Latn
 *    тест яг үүн дээр тогтоно.
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
    // ⚠️ ЗӨВХӨН ҮСЭГ хураана.  `1200` → `120` болвол дугаараар хайх
    //    боломжгүй болно — норм нь яг тоогоороо ялгагдана.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}
