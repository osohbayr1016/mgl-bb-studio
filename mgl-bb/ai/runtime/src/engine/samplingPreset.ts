/**
 * MGL AI · ТҮҮВЭРЛЭЛТИЙН ТОХИРГОО — QWEN3-ИЙН АЛБАН ЁСНЫ ЗӨВЛӨМЖ.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЯАГААД ОРШИХ БОЛСОН ВЭ (2026-09-09-ны оношилгоо).
 *
 *    Хөдөлгүүр нь `temperature: 0.3`, `top_p: 0.9` ГЭСЭН ХОЁРЫГ Л илгээж,
 *    `top_k`, `min_p`, `presence_penalty`-г ОГТ илгээдэггүй байв — тэдгээр
 *    талбарууд `GenerateRequest`-д ч БАЙГААГҮЙ.  Үр дүнд нь llama.cpp-ийн
 *    өөрийн өгөгдмөл (top_k=40, min_p=0.05, presence_penalty=0) хүчинтэй
 *    болж, Qwen3-ийн албан ёсны зөвлөмжөөс БҮХ талбар зөрж байв.
 *
 *    Qwen3-ийн загварын карт нь ТОДОРХОЙ хэлдэг:
 *      • «DO NOT use greedy decoding, as it can lead to performance
 *         degradation and endless repetitions.»
 *      • Non-thinking (enable_thinking=false):
 *         Temperature=0.7, TopP=0.8, TopK=20, MinP=0
 *      • «you can adjust the presence_penalty parameter between 0 and 2
 *         to reduce endless repetitions.  However, using a higher value may
 *         occasionally result in language mixing and a slight decrease in
 *         model performance.»
 *
 *    `temperature: 0.3` нь шуналт (greedy) декодчилол руу ХАЛЬТИРСАН
 *    тохиргоо бөгөөд `presence_penalty: 0`-той хослоод яг тэр
 *    баримтжуулсан гажгийг үүсгэж байв.  ХЭМЖСЭН (Qwen3-8B-Q4_K_M,
 *    llama.cpp b10850, 24 гүйлт): 0.3 дээр 4/24 хариулт төгсгөлгүй
 *    давталтад орсон — жишээ нь «үндэслэл, төлөвлөгөөний» гэсэн ХОЁР
 *    ҮГИЙГ 42 удаа давтаж max_tokens дуустал үргэлжилсэн.
 *
 * ⚠️ `presence_penalty` НЬ 1.5 БИШ, 1.0.  Албан ёсны заавар нь өндөр
 *    утга нь «language mixing» үүсгэж болзошгүй гэж сануулдаг.  Энэ
 *    програм нь МОНГОЛ хэлээр хариулах ёстой бөгөөд загвар аль хэдийн
 *    заримдаа англи руу шилждэг (тийм учраас `validate.ts`-д хэлний
 *    засварын зам бий).  Тиймээс давталтыг зогсооход ХАНГАЛТТАЙ хамгийн
 *    БАГА утгыг сонгов — хэмжилтээр баталгаажуулсан.
 *
 * ⚠️ ЭНЭ НЬ «ДАВТАЛТЫН ТОРГУУЛЬ»-ААР АСУУДЛЫГ НУУХ ОРОЛДЛОГО БИШ.
 *    `repeat_penalty` / `no_repeat_ngram` зэрэг хатуу хориг нь техникийн
 *    хариултыг эвддэг: «БНбД», «заалт», хүснэгтийн шошго, томьёо давтагдах
 *    нь ЗӨВ.  Энд хийж буй зүйл нь загварын АЛБАН ЁСНЫ суурь тохиргоог
 *    сэргээх — өөрөөр хэлбэл буруу тохиргоог ЗАСАХ.
 */

/** Хөдөлгүүрт очих бүрэн түүвэрлэлтийн багц. */
export interface SamplingParams {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  presencePenalty: number;
}

/**
 * Qwen3, СЭТГЭХГҮЙ горим (`enable_thinking: false`) — албан ёсны утгууд.
 *
 * ⚠️ СЭТГЭХ ГОРИМД ӨӨР УТГА ХЭРЭГТЭЙ (temperature 0.6 / top_p 0.95).
 *    Бид сэтгэх горимыг зориуд унтраасан (`LlamaCppEngine`-ийн тайлбарыг
 *    үз) тул энд зөвхөн сэтгэхгүй горимын багц байна.  Хэрэв хэзээ нэгэн
 *    цагт сэтгэх горим асаах бол ЭНЭ ТОГТМОЛЫГ ЗААВАЛ салгах ёстой —
 *    нэг багцыг хоёр горимд хэрэглэх нь Qwen3-ийн заавартай зөрчилдөнө.
 */
export const QWEN3_NON_THINKING: SamplingParams = {
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
  minP: 0,
  presencePenalty: 1.0,
};

/**
 * Загварын гэр бүлээр түүвэрлэлтийн багц сонгоно.
 *
 * ⚠️ QWEN3-ИЙН УТГЫГ БУСАД ЗАГВАРТ ЗААВАЛ ХЭРЭГЛЭХГҮЙ.  Даалгаврын
 *    шаардлага: «Do not apply original Qwen3 settings indiscriminately to
 *    Qwen3-Coder, Thinking-only, Instruct-2507, or other variants.»
 *    Танихгүй загварт `null` буцаана — тэр үед llama.cpp-ийн өөрийн
 *    өгөгдмөл үлдэх ба бид ЮУ Ч тулгахгүй.
 *
 * @param artifact GGUF файлын нэр (жишээ нь `Qwen3-8B-Q4_K_M.gguf`).
 */
export function presetFor(artifact: string | null): SamplingParams | null {
  if (!artifact) return null;
  const name = artifact.toLowerCase();
  if (!name.includes('qwen3')) return null;

  // ⚠️ Эдгээр хувилбарууд нь ӨӨР зөвлөмжтэй — хүн гараар шалгах хүртэл
  //    бид тэдэнд ЮУ Ч тулгахгүй (llama.cpp-ийн өгөгдмөл үлдэнэ).
  if (name.includes('coder')) return null;
  if (name.includes('thinking')) return null;
  if (name.includes('2507')) return null;

  return QWEN3_NON_THINKING;
}

/**
 * Квантчилсан загвар эсэх — `presence_penalty`-ийн шаардлагад нөлөөлнө.
 *
 * ⚠️ Qwen3-ийн заавар нь давталтын эсрэг `presence_penalty`-г ЯЛАНГУЯА
 *    квантчилсан хувилбарт зөвлөдөг.  Бүтэн нарийвчлалтай (F16/BF16)
 *    загварт шаардлага нь бага.
 */
export function isQuantized(quantization: string | null): boolean {
  if (!quantization) return false;
  return /^(I?Q\d|IQ)/i.test(quantization);
}
