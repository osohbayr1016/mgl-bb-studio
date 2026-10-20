/**
 * MGL AI · ХЭЛНИЙ ТОДОРХОЙЛОЛТ БА ЛАТИН МОНГОЛЫН ХЭВИЙЖҮҮЛЭЛТ (§13).
 *
 * ⚠️ ХЭЛИЙГ ЗАГВАРТ ДААЛГАЖ БОЛОХГҮЙ.  Qwen3 нь латинаар бичсэн монгол
 *    («chi ymar asuultand hariulj chadah ve») -ыг АНГЛИ гэж үзээд
 *    англиар хариулдаг.  Тэр нь хэрэглэгчийн 80% нь монголоор бичдэг
 *    бүтээгдэхүүнд хүлээн зөвшөөрөгдөхгүй.  Тиймээс хэлийг СЕРВЕР
 *    тодорхойлж, зааварт ТУШААЛ болгож өгнө.
 *
 * ⚠️ ЦЭВЭР ФУНКЦУУД — D1-гүй, `node --test`-ээр бүрэн хэмжигдэнэ.
 *    Хэлний чиглүүлэлт нь бүтээгдэхүүний мэдрэмжийг тодорхойлдог тул
 *    регрессийг тестээр Л барина.
 */

export type UserLanguage = 'mn-Cyrl' | 'mn-Latn' | 'en' | 'mixed';

/** Хариултын хэл — `mixed` нь монгол давамгайлсан гэсэн үг. */
export type ResponseLanguage = 'mn-Cyrl' | 'en';

/* ================================================================== */
/*  1. Латин монголын тэмдэг үгс                                       */
/* ================================================================== */

/**
 * Латинаар бичсэн монгол үгс.
 *
 * ⚠️ ЗӨВХӨН МОНГОЛД ОНЦГОЙ үгсийг оруулна.  Англи үгтэй давхцах
 *    («men», «bar», «son») үг оруулбал англи өгүүлбэрийг монгол гэж
 *    буруу таана.  Жишээ нь «ter» нь монголоор «тэр» ч англи «term»-ийн
 *    хэсэг биш бүтэн үг тул аюулгүй.
 *
 * ⚠️ Энэ жагсаалт нь ТАНИХАД, хэвийжүүлэхэд БИШ.  Хэвийжүүлэлт нь
 *    доорх `LATIN_TO_CYRILLIC`.
 */
const MN_LATIN_MARKERS = new Set([
  // төлөөний үг / асуултын үг
  // ⚠️ «end», «bid» ХАСАГДСАН (Session C): англи «at the end», «submit a bid»
  //    гэсэн өгүүлбэр латин монгол болж, англи хэрэглэгч монгол хариу авч байв.
  //    «энд» → «end» бичдэг хүн бараг үргэлж өөр тэмдэг үгтэй хамт бичдэг.
  'bi', 'chi', 'ta', 'tanai', 'manai', 'minii', 'chinii',
  'ene', 'ter', 'tend', 'ingej', 'tegej',
  'yamar', 'ymar', 'yu', 'yuu', 'yun', 'yaj', 'yaaj', 'yagaad', 'yagad',
  'hed', 'heden', 'hezee', 'haana', 'hen', 'ali',
  // түгээмэл үйл үг / нэр үг
  'bna', 'bgaa', 'baigaa', 'baina', 'bailgaa', 'baih', 'bolno', 'bol', 'boloh',
  'heregtei', 'hiih', 'hiigeed', 'hiisen', 'hariul', 'hariulah', 'hariulaarai',
  'asuult', 'asuult', 'asuu', 'ajil', 'ajiltan', 'ajilladag',
  'barilga', 'zurag', 'tusul', 'tosol', 'tuslah', 'tusalj',
  'medeelel', 'medeh', 'medne', 'ugeh', 'ogoh', 'harah', 'haruul',
  'deer', 'dotor', 'doosh', 'deesh', 'ruu', 'luu',
  'zov', 'buruu', 'sain', 'muu', 'ih', 'baga', 'olon', 'tsoon',
  'mongol', 'mongoloor', 'mongolaar', 'angli', 'angliar',
  'udaan', 'udaad', 'hurdan', 'hugatsaa', 'ognoo',
  'songoson', 'songoh', 'songo', 'tootsoo', 'tootsoolol',
  'chadah', 'chadna', 'chadah', 'geed', 'gej', 'gesen', 'geh',
  'bhgui', 'baihgui', 'ugui', 'tiim', 'za',
  'shalgah', 'shalga', 'shineer', 'huuchin',
  'hamgiin', 'oiro', 'oirhon', 'tailan', 'daalgavar',
  // ⚠️ 2026-09-28 (эзний бодит чат): «Mongold hudaldaanii tov barilaa gehed, tog us avah norm durem baidag uu»
  //    нь дээрх жагсаалтын НЭГ Ч үггүй тул АНГЛИ гэж танигдаж англиар хариулсан.  Асуултын сул үг, түгээмэл
  //    үйл үг, нормын үгс — англи үгтэй давхцахгүй нь.  Жагсаалт ганцаараа хэзээ ч бүрэн болохгүй тул доорх
  //    `mnMorphology` (залгавраар таних) нь үндсэн хамгаалалт.
  'uu', 'vuu', 'ym', 'yum', 'yumuu', 'bilee',
  'baidag', 'bdag', 'baidgiin', 'bdg', 'baij', 'baisan', 'bsan', 'baihgui',
  'yostoi', 'bolohgui', 'bolomjtoi', 'bolomjgui', 'bolj', 'bolson', 'bolood',
  'avah', 'avsan', 'avch', 'ogson', 'ogooch', 'hiij', 'hiine', 'hiivel', 'barih', 'barij', 'oroh', 'orson', 'yavah', 'yavsan',
  'gehed', 'geheer', 'gedeg', 'gene', 'gevel',
  'durem', 'durmiin', 'durmuud', 'shaardlaga', 'zaalt', 'husnegt', 'tailbar', 'tailbarla', 'tailbarlaach',
  'helj', 'hel', 'helnii', 'oilgoh', 'oilgoj', 'oilgohgui', 'oilgomjtoi', 'nairuulga', 'nairullaga',
  'odoo', 'daraa', 'umnu', 'omno', 'tegvel', 'tegeed', 'harin', 'bas', 'ch',
  'nadad', 'nadaas', 'tsaashid', 'bogino', 'dahin', 'dahiad', 'ooroo', 'ooriin',
  // AEC-ийн түгээмэл латин чат.
  'undur', 'ondor', 'davhar', 'barilgiin', 'barilgyn', 'tsahilgaan', 'tsahilgaanii',
  'galyn', 'galiin', 'achaalal', 'evakuats', 'garc', 'shat', 'shatnii', 'gishguur',
  'hashlaga', 'daats', 'butets', 'buteets', 'beton', 'armatur', 'bagana', 'hana',
  'hananii', 'talbai', 'hemjee', 'urgun', 'zuzaan',
  'huchintei', 'huchingui', 'murduh', 'mordoh', 'tuluvlult', 'tuluvluh',
  'gazar', 'hodlolt', 'salhi', 'salhinii', 'daralt', 'utaa', 'utaany',
  'hamgaalalt', 'tusgaarlalt', 'galtesver', 'galtasver', 'shaardlagatai',
  'tulguur', 'holbolt', 'zangilaa', 'huch', 'hushuun', 'hushuunchanar',
  'deformats', 'deformatsiin', 'gan', 'tumurbeton', 'tomorbeton',
  'nasos', 'bosoo', 'shugam', 'shugamiin', 'bohir', 'ariutgah',
]);

/**
 * Англи хэлний ҮЙЛ ҮГГҮЙ «туслах» үгс — латин бичвэрт англи давамгайлж буйн дохио.
 * ⚠️ «be», «ve» нь монголын «бэ», «вэ» асуултын сул үгтэй давхцана — тиймээс эндээс ХАСАГДСАН, доорх
 *    `mnMorphology` нь тэднийг зөвхөн ӨГҮҮЛБЭРИЙН ТӨГСГӨЛД тоолно («… hed ve?»), англид тийм төгсгөл байхгүй.
 */
const EN_FUNCTION = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'am', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with',
  'what', 'which', 'how', 'why', 'when', 'who', 'whom', 'where', 'do', 'does', 'did', 'can', 'could',
  'should', 'would', 'will', 'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your', 'our', 'their',
  'me', 'you', 'we', 'they', 'i', 'please', 'there', 'have', 'has', 'had', 'show', 'tell', 'give', 'about',
  'from', 'by', 'at', 'as', 'not', 'any', 'all', 'some', 'if', 'than', 'then', 'into', 'only', 'also', 'us',
  'need', 'want', 'list', 'many', 'much',
]);

/**
 * Англи үг боловч монгол залгавартай ИЖИЛ төгсгөлтэй үгс — морфологийн тоололд орохгүй.
 * («door», «floor», «engineer», «need», «seen» г.м.)
 */
const EN_SUFFIX_EXCEPTIONS = new Set([
  'door', 'floor', 'poor', 'engineer', 'engineers', 'career', 'beer', 'peer', 'steer', 'cheer', 'volunteer', 'pioneer',
  'need', 'feed', 'seed', 'speed', 'indeed', 'proceed', 'exceed', 'succeed', 'bazaar', 'yeah', 'blah', 'oops',
]);

/**
 * МОНГОЛ ЗАЛГАВРААР ТАНИХ (2026-09-28).  Латин монгол бичвэрийн үг бүр тэмдэг үгийн жагсаалтад байх албагүй —
 * «hudaldaanii», «barilaa», «baidag», «tsahilgaantai» гэх мэт нь залгавраараа танигдана.  Зөвхөн англид бараг
 * тохиолддоггүй төгсгөлүүд: -iin/-ii (харьяалах), -iig (заах), -aar/-oor/-eer/-uur (үйлдэх), -aas/-oos (гарах),
 * -tai/-tei/-toi (хамтрах), -dag/-deg (давтамж), -gui (үгүйсгэл), -lj/-ij (нөхцөл), -aad/-eed (дараалал),
 * -laa/-lee/-loo (өнгөрсөн), -uud/-nuud (олон тоо), эгшгийн араах -h (үйл үг: avah, barih) ба -hed/-had/-hod
 * («gehed», «barihad» — англи «-shed/-ched» нь гийгүүлэгчийн араас тул таарахгүй), хүсэлт -aach/-eech/-ooch, эелдэг
 * тушаал -aarai/-eerei/-rai/-rei, өөрийн хамаатуулах -aa («hariultaa»).  Сул үг «ve/be/uu» нь зөвхөн
 * төгсгөлд.  ⚠️ «-san/-sen/-son», «-ood», «-ees», «-vel» ХАСАГДСАН — «person», «good», «employees», «level».
 */
const MN_SUFFIX = /^[a-z]{2,}(?:iin|ii|iig|aar|oor|eer|uur|aas|oos|tai|tei|toi|dag|deg|gui|lj|ij|aad|eed|laa|lee|loo|uud|aach|eech|ooch|aarai|eerei|ooroi|rai|rei|aa)$/;
const MN_VERB_H = /^[a-z]{2,}[aeiouy](?:h|hed|had|hod)$/;
function mnMorphology(w: readonly string[]): number {
  let n = 0;
  for (const x of w) {
    if (!/^[a-z]+$/.test(x) || EN_SUFFIX_EXCEPTIONS.has(x) || TECH_TERMS.has(x)) continue;
    if (MN_SUFFIX.test(x) || MN_VERB_H.test(x)) n += 1;
  }
  const last = w[w.length - 1];
  if (last === 've' || last === 'be' || last === 'uu' || last === 'yu') n += 1;
  return n;
}

/**
 * Латин → кирилл хэвийжүүлэлтийн толь.
 *
 * ⚠️ ЗОРИЛГО НЬ ХАЙЛТ, ТАНИЛТ — төгс галиг БИШ (§9).  «tusul» → «төсөл»
 *    гэж хөрвүүлэх нь `lexicalSearch`-д зөв хэсгийг олоход хангалттай;
 *    хэрэглэгчид харагдах текст нь ТҮҮНИЙ ӨӨРИЙНХ нь бичсэн хэвээр
 *    үлдэнэ (§9: «Preserve the original user text for conversation»).
 */
const LATIN_TO_CYRILLIC: ReadonlyMap<string, string> = new Map([
  ['bi', 'би'], ['chi', 'чи'], ['ta', 'та'], ['bid', 'бид'],
  ['manai', 'манай'], ['tanai', 'танай'], ['minii', 'миний'],
  ['ene', 'энэ'], ['ter', 'тэр'], ['end', 'энд'],
  ['yamar', 'ямар'], ['ymar', 'ямар'],
  ['yu', 'юу'], ['yuu', 'юу'], ['yun', 'юун'],
  ['yaj', 'яаж'], ['yaaj', 'яаж'],
  ['yagaad', 'яагаад'], ['yagad', 'яагаад'],
  ['hed', 'хэд'], ['heden', 'хэдэн'], ['hezee', 'хэзээ'],
  ['haana', 'хаана'], ['hen', 'хэн'],
  ['bna', 'байна'], ['baina', 'байна'],
  ['bgaa', 'байгаа'], ['baigaa', 'байгаа'],
  ['baih', 'байх'], ['bol', 'бол'], ['boloh', 'болох'], ['bolno', 'болно'],
  ['heregtei', 'хэрэгтэй'],
  ['hiih', 'хийх'], ['hiigeed', 'хийгээд'], ['hiisen', 'хийсэн'],
  ['hariul', 'хариул'], ['hariulah', 'хариулах'], ['hariulaarai', 'хариулаарай'],
  ['asuult', 'асуулт'], ['asuult', 'асуулт'],
  ['ajil', 'ажил'], ['ajiltan', 'ажилтан'],
  ['barilga', 'барилга'], ['zurag', 'зураг'],
  ['tusul', 'төсөл'], ['tosol', 'төсөл'],
  ['tuslah', 'туслах'], ['tusalj', 'тусалж'],
  ['medeelel', 'мэдээлэл'], ['medeh', 'мэдэх'],
  ['deer', 'дээр'], ['dotor', 'дотор'],
  ['zov', 'зөв'], ['buruu', 'буруу'],
  ['mongol', 'монгол'], ['mongoloor', 'монголоор'], ['mongolaar', 'монголоор'],
  ['udaan', 'удаан'], ['udaad', 'удаад'],
  ['hugatsaa', 'хугацаа'], ['ognoo', 'огноо'],
  ['songoson', 'сонгосон'], ['songoh', 'сонгох'],
  ['tootsoo', 'тооцоо'], ['tootsoolol', 'тооцоолол'],
  ['chadah', 'чадах'], ['chadna', 'чадна'],
  ['tailan', 'тайлан'], ['daalgavar', 'даалгавар'],
  ['ajilladag', 'ажилладаг'], ['shalgah', 'шалгах'],
  ['hamgiin', 'хамгийн'], ['oirhon', 'ойрхон'],
  ['angilal', 'ангилал'], ['ali', 'аль'], ['norm', 'норм'],

  // AEC / барилгын бодит латин чат — retrieval + intent + model understanding.
  ['undur', 'өндөр'], ['ondor', 'өндөр'], ['undurbarilga', 'өндөрбарилга'],
  ['barilgiin', 'барилгын'], ['barilgyn', 'барилгын'], ['barilgad', 'барилгад'],
  ['davhar', 'давхар'], ['davhriin', 'давхрын'], ['davhryn', 'давхрын'],
  ['tsahilgaan', 'цахилгаан'], ['tsahilgaanii', 'цахилгааны'], ['tsahilgaantai', 'цахилгаантай'],
  ['us', 'ус'], ['usan', 'усан'], ['usnii', 'усны'],
  ['agaarselgelt', 'агаарсэлгэлт'], ['agaarsolilt', 'агаарсолилцоо'],
  ['agaarsolilts', 'агаарсолилцоо'], ['salhivch', 'салхивч'],
  ['galyn', 'галын'], ['galiin', 'галын'], ['gal', 'гал'],
  ['achaalal', 'ачаалал'], ['achaalliin', 'ачааллын'],
  ['evakuats', 'эвакуац'], ['evakuatsiin', 'эвакуацын'], ['garts', 'гарц'], ['garc', 'гарц'],
  ['shat', 'шат'], ['shatnii', 'шатны'], ['gishguur', 'гишгүүр'], ['hashlaga', 'хашлага'],
  ['daats', 'даац'], ['dats', 'даац'], ['butets', 'бүтээц'], ['buteets', 'бүтээц'],
  ['suuri', 'суурь'], ['suuriin', 'суурийн'],
  ['beton', 'бетон'], ['armatur', 'арматур'], ['damnuru', 'дамнуруу'], ['damnuruun', 'дамнурууны'],
  ['bagana', 'багана'], ['hana', 'хана'], ['hananii', 'хананы'],
  ['zai', 'зай'], ['hemjee', 'хэмжээ'], ['org', 'өргөн'], ['urgun', 'өргөн'],
  ['zuzaan', 'зузаан'], ['undurtei', 'өндөртэй'], ['talbai', 'талбай'],
  ['shal', 'шал'], ['taaz', 'тааз'], ['haalga', 'хаалга'], ['tsonh', 'цонх'],
  ['zurag-tusul', 'зураг-төсөл'], ['zuragtusul', 'зурагтөсөл'], ['zurgiin', 'зургийн'],
  ['huchintei', 'хүчинтэй'], ['huchingui', 'хүчингүй'], ['murduh', 'мөрдөх'], ['mordoh', 'мөрдөх'],
  ['tuluvlult', 'төлөвлөлт'], ['tuluvluh', 'төлөвлөх'], ['tuluvluhuu', 'төлөвлөх үү'],
  ['gazar', 'газар'], ['hodlolt', 'хөдлөлт'], ['gazarkhodlolt', 'газархөдлөлт'],
  ['salhi', 'салхи'], ['salhinii', 'салхины'], ['daralt', 'даралт'], ['daraltiin', 'даралтын'],
  ['utaa', 'утаа'], ['utaany', 'утааны'], ['utaag', 'утааг'],
  ['hamgaalalt', 'хамгаалалт'], ['tusgaarlalt', 'тусгаарлалт'],
  ['galtesver', 'галтэсвэр'], ['galtasver', 'галтэсвэр'], ['galtesverlel', 'галтэсвэрлэл'],
  ['shaardlagatai', 'шаардлагатай'], ['shaardlaga', 'шаардлага'],
  ['tulguur', 'тулгуур'], ['tulguuriin', 'тулгуурын'], ['holbolt', 'холболт'], ['zangilaa', 'зангилаа'],
  ['huch', 'хүч'], ['hushuun', 'хөшүүн'], ['hushuunchanar', 'хөшүүнчанар'],
  ['deformats', 'деформац'], ['deformatsiin', 'деформацын'],
  ['gan', 'ган'], ['tumurbeton', 'төмөрбетон'], ['tomorbeton', 'төмөрбетон'],
  ['nasos', 'насос'], ['nasosnii', 'насосны'], ['bosoo', 'босоо'],
  ['shugam', 'шугам'], ['shugamiin', 'шугамын'], ['bohir', 'бохир'], ['ariutgah', 'ариутгах'],
  ['core', 'core'], ['shaft', 'shaft'], ['clash', 'clash'], ['duct', 'duct'],
  ['engineer', 'engineer'], ['architect', 'architect'],
]);

/**
 * Салбарын нэр томьёо — ХӨРВҮҮЛЭХГҮЙ, ТООЛОХГҮЙ (§8).
 *
 * ⚠️ Эдгээр нь монгол өгүүлбэрт англиар үлддэг.  Хэл таних үед тэднийг
 *    «англи» гэж тоовол «Revit deer wall-iin area hed ve» гэсэн монгол
 *    өгүүлбэр англи гэж ангилагдана.
 */
const TECH_TERMS = new Set([
  'revit', 'view', 'family', 'type', 'parameter', 'deadline', 'task',
  'project', 'erp', 'server', 'api', 'model', 'ai', 'gpu', 'sheet',
  'schedule', 'warning', 'workset', 'wall', 'door', 'window', 'floor',
  'level', 'room', 'area', 'volume', 'element', 'category', 'sync',
  'export', 'import', 'pdf', 'dwg', 'ifc', 'bim', 'cad', 'excel',
  'mj', 'm2', 'm3', 'kg', 'mm', 'cm', 'km',
  'core', 'shaft', 'clash', 'duct', 'pipe', 'diffuser', 'hanger', 'opening',
  'pressure', 'zone', 'drift', 'load', 'frame', 'concept', 'layout',
]);

/** Кирилл үсэг агуулсан эсэх. */
function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿ]/.test(text);
}

function cyrillicRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const cyr = letters.filter((c) => /[Ѐ-ӿ]/.test(c)).length;
  return cyr / letters.length;
}

/** Үгэнд хуваана — тоо, тэмдэгтийг хасна. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/* ================================================================== */
/*  2. Хэл таних                                                       */
/* ================================================================== */

export interface LanguageDetection {
  language: UserLanguage;
  /** Загварт өгөх ТУШААЛ — `mixed` нь монгол руу шийдэгдэнэ. */
  responseLanguage: ResponseLanguage;
  /** Хэрэглэгч ил тодоор хэл сонгосон эсэх. */
  explicitRequest: boolean;
  /** Хайлт/танилтад ашиглах хэвийжүүлсэн текст. */
  normalized: string;
  /** Оношилгоонд: латин монголын хэдэн тэмдэг олдсон. */
  latinMarkers: number;
}

/**
 * Хэрэглэгч ИЛ ТОДООР хэл сонгосон эсэх.
 *
 * ⚠️ Энэ нь бусад бүх дүрмээс ДЭЭГҮҮР.  «mongoloor hariulaarai» гэж
 *    бичсэн хүн англи хариу авах ёсгүй, бичвэр нь латин байсан ч.
 */
function detectExplicitRequest(text: string, w: readonly string[]): ResponseLanguage | null {
  const t = text.toLowerCase();
  // Монголоор хариул
  if (
    /монгол(оор|ор)/.test(t) ||
    w.includes('mongoloor') ||
    w.includes('mongolaar') ||
    /\bin mongolian\b/.test(t) ||
    /\bmongolian\b.*\b(answer|reply|respond)\b/.test(t) ||
    /\b(answer|reply|respond)\b.*\bmongolian\b/.test(t)
  ) {
    return 'mn-Cyrl';
  }
  // Англиар хариул
  if (
    /англи(ар|аар)/.test(t) ||
    w.includes('angliar') ||
    w.includes('angliaar') ||
    /\bin english\b/.test(t) ||
    /\benglish\b.*\b(answer|reply|respond)\b/.test(t) ||
    /\b(answer|reply|respond)\b.*\benglish\b/.test(t)
  ) {
    return 'en';
  }
  return null;
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Хэрэглэгчийн хэлийг ТОДОРХОЙЛНО.
 *
 * Дараалал (эрэмбээр):
 *   1. ИЛ ХҮСЭЛТ («монголоор хариул») — бүхнээс дээгүүр.
 *   2. Кирилл байвал → mn-Cyrl.
 *   3. Латин монголын тэмдэг үг байвал → mn-Latn (эсвэл mixed).
 *   4. Үгүй бол → en.
 *
 * ⚠️ ЛАТИН МОНГОЛ НЬ АВТОМАТААР АНГЛИ БОЛОХГҮЙ (§2).  Энэ файлын
 *    оршин байх шалтгаан нь тэр нэг мөр.
 */
export function detectLanguage(question: string): LanguageDetection {
  const text = question ?? '';
  const w = words(text);
  const explicit = detectExplicitRequest(text, w);

  const cyr = cyrillicRatio(text);
  const markers = w.filter((x) => MN_LATIN_MARKERS.has(x)).length;
  const techCount = w.filter((x) => TECH_TERMS.has(x)).length;
  // Нэр томьёог «англи нотолгоо» гэж тоолохгүй (§8).
  const nonTechLatin = w.filter((x) => !TECH_TERMS.has(x) && /^[a-z]+$/.test(x)).length;
  // Тэмдэг үггүй латин бичвэр: монгол залгавар англи туслах үгээс ДАВАМГАЙЛБАЛ монгол (2026-09-28).
  const morph = markers > 0 ? 0 : mnMorphology(w);
  const enFunction = markers > 0 ? 0 : w.filter((x) => EN_FUNCTION.has(x)).length;
  const morphMongolian = morph >= 2 && morph > enFunction;

  let language: UserLanguage;
  if (hasCyrillic(text) && cyr >= 0.3) {
    // Кирилл давамгайлсан.  Латин нэр томьёо байвал `mixed`.
    language = techCount > 0 || nonTechLatin > 0 ? 'mixed' : 'mn-Cyrl';
  } else if (markers > 0 || morphMongolian) {
    // ⚠️ Латин монгол.  Нэг тэмдэг ч хангалттай: «bi», «chi», «yu ve»
    //    гэх мэт богино асуулт нь бодит хэрэглээ.
    language = techCount > 0 ? 'mixed' : 'mn-Latn';
  } else if (hasCyrillic(text)) {
    language = 'mn-Cyrl';
  } else {
    language = 'en';
  }

  // ⚠️ `mixed` НЬ МОНГОЛ РУУ ШИЙДЭГДЭНЭ.  §1: «Mixed Mongolian + English
  //    technical terms -> respond primarily in Mongolian».
  let responseLanguage: ResponseLanguage =
    language === 'en' ? 'en' : 'mn-Cyrl';
  if (explicit !== null) responseLanguage = explicit;

  return {
    language,
    responseLanguage,
    explicitRequest: explicit !== null,
    normalized: normalizeLatinMongolian(text),
    latinMarkers: markers + morph,
  };
}

/* ================================================================== */
/*  3. Хэвийжүүлэлт (§9)                                               */
/* ================================================================== */

/**
 * Латинаар бичсэн монгол үгсийг кирилл болгоно — ХАЙЛТАД зориулж.
 *
 * ⚠️ ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ.  Энэ нь `lexicalSearch` болон санаа
 *    таниход л ашиглагдана; ярианд хэрэглэгчийн ЭХ бичвэр үлдэнэ (§9).
 *
 * ⚠️ Танихгүй үгийг ХЭВЭЭР үлдээнэ — таамаглаж гуйвуулах нь хайлтыг
 *    сайжруулахаас илүү мууруулна.
 */
export function normalizeLatinMongolian(text: string): string {
  if (!text) return '';
  return text.replace(/[A-Za-z]+/g, (token) => {
    const lower = token.toLowerCase();
    // Нэр томьёог хөрвүүлэхгүй — «wall», «revit» нь хайлтад ижилээрээ хэрэгтэй.
    if (TECH_TERMS.has(lower)) return token;
    return LATIN_TO_CYRILLIC.get(lower) ?? token;
  });
}

/**
 * Хайлтад өгөх текст: кирилл асуулт бол өөрөө, латин бол хэвийжүүлсэн.
 *
 * ⚠️ ХОЁУЛАНГ НЬ НИЙЛҮҮЛНЭ.  Латин хэлбэр нь баримтад байхгүй ч
 *    нэр томьёо («Revit», «wall») нь эх хэлбэрээрээ хэрэгтэй.
 */
export function searchText(question: string, detection: LanguageDetection): string {
  if (detection.language === 'mn-Cyrl' || detection.language === 'en') return question;
  const norm = detection.normalized;
  return norm === question ? question : `${question} ${norm}`;
}
