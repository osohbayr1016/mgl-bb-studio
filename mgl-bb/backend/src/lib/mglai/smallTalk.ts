/**
 * MGL AI · ХӨНГӨН ЯРИА / МЕТА / ОЙЛГОЛТЫН ДЕТЕРМИНИСТ ХАРИУЛТ (2026-09-18).
 *
 * ⚠️ ЯАГААД.  Эзний тест (адаптер 0.4): «amidral her baina daa» → «Ажилтан бүрд хувилбар байхгүй бол
 *    ажиллагааг унших чадаагүй…», «chi minii asuultiig oilgoj baina uu» → «За, хэлбэрээсээ та би гэдэг
 *    ч манай системийн аль хэсэг вэ…», «barilgiin norm durem gej yu ve» → 31-17-10-ийн гурван заалт.
 *    Хэмжсэн шалтгаан: адаптер 0.4 нь богино бүтэцтэй хариултаар сурсан тул ЧӨЛӨӨТ монгол яриаг
 *    эвдэрсэн өгүүлбэр болгодог; детерминист замаар явсан асуулт бүр (норм, каталог, L1 жагсаалт) зөв.
 *    Тиймээс мэндчилгээ, «ойлгож байна уу», «норм дүрэм гэж юу вэ» гэсэн ОЙЛГОЛТЫН асуулт загварт
 *    очихгүй — богино, зөв, тогтмол хариулт (`templateOnly`).  Загвар сайжрахад (адаптер 0.5) энэ
 *    хаалгыг санаагаар нь сулруулж болно; одоо «эвдэрсэн мэт харагдах»-аас «хатуу боловч зөв» дээр.
 *
 * ⚠️ ЦЭВЭР — D1-гүй; хариултын сонголт асуултын hash-аар детерминист (ижил асуулт = ижил хариулт).
 */
import { foldText } from '../textFold';
import { normalizeLatinMongolian } from './lang';
import { detectNormTopics } from './norm/questionKind';

export type SmallTalkKind =
  | 'greeting'
  | 'how_are_you'
  | 'thanks'
  | 'bye'
  | 'understand_check'
  | 'norm_concept'
  | 'capabilities'
  | 'capabilities_frustrated'
  | 'feedback_language'
  | 'feedback_wrong'
  | 'instructions';

export interface SmallTalk {
  kind: SmallTalkKind;
  text: string;
}

function q(question: string): string {
  const raw = (question ?? '').toLowerCase();
  return `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
}

const RE = {
  // ⚠️ «юу байна» ГАНЦААРАА биш — «Revit дээр сонгосон wall юу байна» нь Revit асуулт (тестээр баригдав).
  //    Амьдрал/сонин-той хамт, эсвэл БҮТЭН асуулт нь «хэр байна даа?» бол л.
  how_are_you: /(амьдрал|amidral|amidr)\s*(хэр|her|yamar|ямар)|(?<!\p{L})(сонин юу|sonin yu|сонин сайхан|sonin saihan|how are you|how's it going)(?!\p{L})|^\s*(хэр байна|her baina|her bna|юу байна|yu baina|yu bna)\s*(даа|дээ|вэ|бэ|daa|dee|ve|be)?\s*[?!.]*\s*$/iu,
  understand_check: /(ойлгож байна уу|ойлгож байгаа юу|ойлгосон уу|ойлгов уу|oilgoj baina uu|oilgoj bna uu|oilgoson uu|oilgov uu|асуултыг ойлго|asuultiig oilgo|do you understand|did you understand|are you following)/iu,
  thanks: /(?<!\p{L})(баярлалаа|баярллаа|bayarlalaa|bayrlalaa|thanks|thank you|гялайлаа|gyalailaa)(?!\p{L})/iu,
  bye: /(?<!\p{L})(баяртай|bayartai|bye|goodbye|сайн яваарай|sain yavaarai)(?!\p{L})/iu,
  greeting: /^\s*(сайн уу|сайн байна уу|сайн байцгаана уу|өглөөний мэнд|оройн мэнд|өдрийн мэнд|sain uu|sain baina uu|sain bna uu|sain bnu|hello|hi|hey|good morning|good evening|мэнд|mend)(?!\p{L})[\s!?.,]*$/iu,
  // «Барилгын норм дүрэм гэж юу вэ», «норм гэдэг нь юу вэ» — код/тоогүй ОЙЛГОЛТЫН асуулт.
  norm_concept: /^(?=.*(норм|дүрэм|дүрм|стандарт|бнбд|norm|durem|durm|standart|bnbd))(?=.*(гэж юу вэ|гэдэг нь юу|гэдэг юу|юу гэсэн үг|гэж юуг хэлэх|gej yu ve|gedeg ni yu|yu gesen ug|what is a|what are))(?!.*\d)(?!.*(заалт|хүснэгт|zaalt|husnegt|галын|galiin|ачаалал|өндөр|зай|талбай)).*$/iu,
} as const;

/**
 * «ЧИ ЮУ ХИЙЖ ЧАДДАГ ВЭ» — ФОЛДООР (2026-09-23).  Эзний HL09: «ugluunees hoish neg ch zov hariult avsangui. chi yg yu
 *    hiij chaddag yum be» → загвар «Хэн ч зөв хариулж чадахгүй, тэрхүү асуултын дараа нь манайд бодож өгч болно…» гэж
 *    эвдэрсэн өгүүлбэр бичсэн.  Чадварын асуулт нь МЕТА — бодит чадвараа товч, үнэн хэлэх детерминист хариулт.
 *    Сэтгэл дундуур дохиотой бол эхэнд нь ганц өгүүлбэрийн уучлал.
 */
const CAPABILITIES_F = /(?:^| )(?:iu hij chad|iu hiih chad|iu hiij chad|iu chaddag|iu medeg|iu medeh ve|iu mededeg|what can iou do|what do iou know|what are iou able)/;
const FRUSTRATED_F = /(?:^| )(?:neg ch zov|iamar ch zov|zov hariult (?:avsangui|ogsongui|ogohgui|alga|bish)|buru hariul|ogt oilgohgui|oilgohgui bain|ogt tuslahgui|nothing (?:right|correct)|wrong again|useless)/;

/**
 * ГОМДОЛ / ШҮҮМЖЛЭЛ — ФОЛДООР (2026-09-28, эзний бодит чат).  «chinii Mongol helnii nairullaga muu ym» → GENERAL_HELP
 *    болж загварт очоод system prompt-ынхаа хэлний тушаалыг («…латин үсгээр монгол бичсэн ч кириллээр хариулна.
 *    Англиар бодож байгаад орчуулж БОЛОХГҮЙ…») үгчлэн цуурайтуулсан.  Гомдол нь асуулт биш — хүлээн авч, 👎-ээр зөв
 *    хувилбарыг өгөхийг санал болгох товч, үнэн хариулт л хэрэгтэй.
 * ⚠️ «буруу ойлголоо, Төсөл Бета-г хэлсэн» нь ЗАСВАР (turn.ts CORRECTION) — энд таарахгүй: «хариулт … буруу»,
 *    «найруулга … муу» гэсэн ЧАНАРЫН үгс л; мөн тоо, нормын/төслийн үгтэй мессеж (шүүмжлэл + жинхэнэ асуулт)
 *    ХЭЗЭЭ Ч энд ирэхгүй (`FEEDBACK_DOMAIN_F`).
 */
const FEEDBACK_LANG_F =
  /(?:^| )(?:nairul\S*|helni|mongol hel\S*|mongolor bich\S*|bichgin hel)(?: \S+){0,4} (?:mu|sul|evgui|buru|tasarhai|aldatai|utgagui|hachin|oilgomjgui|oilgogdohgui)(?: |$)|(?:iour|the) mongolian (?:is |sounds |writing is )?(?:bad|poor|terrible|awful|broken|weird|unnatural)/;
const FEEDBACK_WRONG_F =
  /(?:^| )(?:hariult\S* (?:\S+ ){0,3}(?:mu|buru|utgagui|oilgomjgui|evgui|tasarhai|hachin|zohiomol|hudal)(?: |$)|buru hariul\S*|utgagui (?:hariul|ium|bichij|iaria|zuil|bain)|oilgomjgui (?:bichij|hariul|ium|bain)|ogt (?:tus bolohgui|oilgomjgui|utgagui)|(?:bad|wrong|nonsense|useless|meaningless|terrible) (?:answer|reply|response)|makes no sense|does ?n.?t make sense)/;
const FEEDBACK_DOMAIN_F =
  /(?:^| )(?:norm|durem|durm|bnbd|ubb|snip|zalt|husnegt|angila|tosol|tosl|tusul|project|revit|galin|achal|deadline|ajiltan|daalgavr|task|irc)/;
/** «Чамд ямар заавар өгсөн бэ», «system prompt-оо харуул» — дотоод зааврын ТЕКСТИЙГ хуулахгүй, товч үнэн хариулт. */
// ⚠️ «заавар» ганцаараа БИШ — нормын «аргачилсан заавар» (УББ-11-201-00) асуулт энд орох ёсгүй; зөвхөн ЧАМД/ТАНД
//    өгсөн, ДОТООД заавар эсвэл «system prompt».
const INSTRUCTIONS_F =
  /(?:^| )(?:(?:chamd|tand|chini|tani|dotod)(?: \S+){0,3} (?:zavar|zavr|prompt|instruction)|sistem prompt|(?:show|reveal|print|repeat) (?:me )?(?:iour|the) (?:sistem )?(?:prompt|instructions)|iour (?:sistem )?(?:prompt|instructions))/;

/** Асуулт нь хөнгөн яриа / мета / нормын ойлголтын асуулт уу. */
export function detectSmallTalk(question: string): SmallTalkKind | null {
  const s = q(question);
  const f = ` ${foldText(question ?? '')} `;
  if (CAPABILITIES_F.test(f)) return FRUSTRATED_F.test(f) ? 'capabilities_frustrated' : 'capabilities';
  if (INSTRUCTIONS_F.test(f)) return 'instructions';
  const shortPlain = !/\d/.test(f) && !FEEDBACK_DOMAIN_F.test(f) && f.trim().split(' ').length <= 16;
  if (shortPlain && FEEDBACK_LANG_F.test(f)) return 'feedback_language';
  if (shortPlain && FEEDBACK_WRONG_F.test(f)) return 'feedback_wrong';
  if (RE.understand_check.test(s)) return 'understand_check';
  if (RE.how_are_you.test(s)) return 'how_are_you';
  // NORM-INTEL v3: «Smoke-free stairwell гэж юу вэ? Монголын нормд ямар төрлүүд байдаг вэ?» — «норм» нь ЗОХИЦУУЛАГДСАН СЭДВИЙН
  //   асуултын хэсэг; «норм дүрэм гэж юу вэ» (нормын тухай ойлголт) биш — сэдэвтэй бол нормын хайлт руу.
  if (RE.norm_concept.test(s.trim()) && detectNormTopics(question).length === 0) return 'norm_concept';
  if (RE.thanks.test(s)) return 'thanks';
  if (RE.bye.test(s)) return 'bye';
  if (RE.greeting.test(question) || RE.greeting.test(normalizeLatinMongolian(question))) return 'greeting';
  return null;
}

function pick(list: readonly string[], seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
}

const MN: Record<SmallTalkKind, readonly string[]> = {
  greeting: [
    'Сайн байна уу! Төсөл, ирц, даалгавар, барилгын норм дүрмийн талаар асуугаарай.',
    'Сайн уу! Юугаар туслах вэ — төслийн явц, deadline, норм дүрэм, Revit?',
  ],
  how_are_you: [
    'Сайн, баярлалаа — ажиллахад бэлэн. Танд юугаар туслах вэ: төслийн явц, ирц, норм дүрэм?',
    'Сайн байна, та сайн уу? Асуултаа бичээрэй — төсөл, даалгавар, норм дүрмийн аль нь ч болно.',
  ],
  thanks: ['Зүгээр ээ. Өөр асуулт байвал бичээрэй.', 'Таатай байна. Дараа нь ч асуугаарай.'],
  bye: ['Баяртай, амжилт хүсье.', 'Баяртай! Дараа уулзъя.'],
  understand_check: [
    'Тийм ээ, ойлгож байна. Хариулт тодорхойгүй санагдвал асуултаа арай дэлгэрэнгүй бичээрэй — жишээ нь төслийн нэр, нормын код (БД 21-101-12), тоо хэмжээ (g=1800 МДж/м²) зэргийг оруулбал би яг тэр зүйлээр хариулна.',
  ],
  capabilities: ['Би хоёр зүйлд найдвартай тусална:\n1. **Барилгын норм, дүрэм** — мэдлэгийн санд буй нормын заалтыг эх сурвалжтай нь хэлж, тайлбарлана (жишээ нь «Даамал ажлыг зогсоож болох уу?», «Цэцэрлэгийн тоглоомын талбайд нар хэдэн цаг тусах ёстой вэ?»).\n2. **Компанийн өгөгдөл** — төсөл, даалгавар, хугацаа, ажилтны мэдээллийг системээс шууд авч хэлнэ (жишээ нь «Хамгийн ойр дуусах төсөл аль вэ?»).\n\nСанд байхгүй норм, интернэтийн мэдээлэлд найдвартай хариулж чадахгүй — тийм үед «олдсонгүй» гэж шууд хэлнэ.'],
  capabilities_frustrated: [
    'Уучлаарай, хүлээлтийг тань хангасангүй. Би хоёр зүйлд найдвартай тусална:\n1. **Барилгын норм, дүрэм** — мэдлэгийн санд буй нормын заалтыг эх сурвалжтай нь хэлж, тайлбарлана (жишээ нь «Даамал ажлыг зогсоож болох уу?», «Цэцэрлэгийн тоглоомын талбайд нар хэдэн цаг тусах ёстой вэ?»).\n2. **Компанийн өгөгдөл** — төсөл, даалгавар, хугацаа, ажилтны мэдээллийг системээс шууд авч хэлнэ (жишээ нь «Хамгийн ойр дуусах төсөл аль вэ?»).\n\nСанд байхгүй норм, интернэтийн мэдээлэлд найдвартай хариулж чадахгүй — тийм үед «олдсонгүй» гэж шууд хэлнэ.\n\nАль асуултад буруу хариулсныг хэлбэл, эх сурвалжаас нь дахин шалгая.',
  ],
  feedback_language: [
    'Уучлаарай — найруулга эвгүй байгааг хүлээн авлаа. Би монголоор илүү ойлгомжтой бичихээр сургагдаж байгаа бөгөөд ийм санал яг үүнд хэрэгтэй.\n\nХамгийн их тус болох хоёр зүйл:\n1. Эвгүй санагдсан хариулт дээр 👎 дараад зөв хувилбарыг нь бичээрэй — шалгагдсаны дараа сургалтын жишээ болно.\n2. Асуултаа дахин асуувал илүү товч, энгийнээр хариулахыг хичээе.',
  ],
  feedback_wrong: [
    'Уучлаарай, хариулт буруу эсвэл ойлгомжгүй байсан бол энэ нь миний алдаа.\n\nАль асуултад юу нь буруу байсныг хэлбэл эх сурвалжаас нь дахин шалгая. Тэр хариулт дээр 👎 дараад зөв хувилбарыг бичвэл шалгагдсаны дараа сургалтын жишээ болно.',
  ],
  instructions: [
    'Дотоод зааврынхаа текстийг хуулж харуулдаггүй. Товчхондоо миний ажиллах зарчим: хариултаа монголоор бичнэ; төсөл, ажилтны тоо, нормын заалт, тоон утгыг зөвхөн системийн эх сурвалжаас авна; эх сурвалж олдоогүй бол зохиохгүй, «олдсонгүй» гэж шууд хэлнэ.',
  ],
  norm_concept: [
    'Барилгын норм дүрэм гэдэг нь барилга байгууламжийг төлөвлөх, барих, ашиглахад заавал мөрдөх техникийн шаардлагыг тогтоосон албан баримт бичиг юм. Монголд БНбД (Барилгын норм ба дүрэм), БД (Барилгын дүрэм), УББ (Улсын барилгын баримт бичиг), MNS стандарт, мөн Монголд хүчинтэй хэвээр байгаа зарим СНиП орно; жагсаалтыг MCIS (mcis.gov.mn) хөтөлдөг. Надаас «чамд ямар норм байгаа вэ» гэж асуувал санд шингээсэн баримтуудаа, «БД 21-101-12 юуны тухай вэ» гэвэл тухайн баримтын бүтцийг, тодорхой утга («g=1800 МДж/м² бол ямар ангилал вэ») асуувал заалттай нь хариулна.',
  ],
};

const EN: Record<SmallTalkKind, readonly string[]> = {
  greeting: ['Hello! Ask me about projects, attendance, tasks or Mongolian building codes.'],
  how_are_you: ['Doing well, thanks — ready to work. What do you need: project progress, attendance, building codes?'],
  thanks: ['You are welcome. Ask anytime.'],
  bye: ['Goodbye, good luck.'],
  understand_check: ['Yes, I follow. If an answer looked off, add a project name, a code (БД 21-101-12) or a value (g=1800 MJ/m²) and I will answer precisely.'],
  capabilities: ['I can reliably help with two things:\n1. **Building codes** — clauses from the codes in my knowledge base, with the source (e.g. «Can the site foreman stop the work?»).\n2. **Company data** — projects, tasks, deadlines and staff, read live from the system (e.g. «Which project is due soonest?»).\n\nI cannot answer reliably about codes that are not in my knowledge base or about internet information — then I say so directly.'],
  capabilities_frustrated: ['Sorry that the answers missed the mark. I can reliably help with two things:\n1. **Building codes** — clauses from the codes in my knowledge base, with the source (e.g. «Can the site foreman stop the work?»).\n2. **Company data** — projects, tasks, deadlines and staff, read live from the system (e.g. «Which project is due soonest?»).\n\nI cannot answer reliably about codes that are not in my knowledge base or about internet information — then I say so directly.\n\nTell me which answer was wrong and I will check it against the source again.'],
  feedback_language: ['Sorry — noted that the phrasing was awkward. I am being trained to write clearer Mongolian, and feedback like this is exactly what helps.\n\nTwo things help most:\n1. Press 👎 on the awkward answer and write the correct version — once reviewed it becomes a training example.\n2. Ask again and I will try to answer more simply.'],
  feedback_wrong: ['Sorry — if the answer was wrong or unclear, that is my mistake.\n\nTell me which question and what was wrong, and I will check the source again. Pressing 👎 on that answer and writing the correct version turns it into a training example once reviewed.'],
  instructions: ['I do not reproduce my internal instructions. In short: I answer in the user\'s language; project data, headcounts, norm clauses and numbers come only from the system\'s sources; when nothing is found I say so instead of making it up.'],
  norm_concept: ['Building codes (норм дүрэм) are the official documents that set the mandatory technical requirements for designing, constructing and operating buildings. In Mongolia they are БНбД, БД, УББ, MNS standards and some СНиП still in force, registered by MCIS (mcis.gov.mn). Ask «which codes do you have» for my knowledge base, «what is БД 21-101-12 about» for a document outline, or a concrete value question for a cited clause.'],
};

export function smallTalkReply(kind: SmallTalkKind, question: string, lang: 'mn-Cyrl' | 'en'): SmallTalk {
  return { kind, text: pick(lang === 'en' ? EN[kind] : MN[kind], question) };
}
