/**
 * MGL AI · МЭДЛЭГИЙН САНГИЙН КАТАЛОГ — «чамд ямар норм байгаа вэ», «БНбД X юуны тухай вэ».
 *
 * ⚠️ ЯАГААД ЭНЭ ФАЙЛ ОРШИН БАЙНА (2026-09-18, ХЭМЖСЭН).  «chamd ymar norm durmuud
 *    baigaa ve» гэсэн асуулт:
 *      1. `NORMATIVE_HINTS`-ийн «норм» үгээр NORMATIVE → нотолгоо ЗААВАЛ;
 *      2. локал `/norm` BM25 нь агуулгын токен олохгүй → `insufficient_evidence`;
 *      3. загвар хоосон хайрцагтай үлдэж, system prompt-ынхаа СҮҮЛИЙН мөрийг
 *         («Идэвхгүй хэлбэрээс идэвхтэйг илүүд үз.») цуурайтуулж «Эргэлзээтэй» гэж гарав.
 *    Асуулт нь заалтын асуулт огт БИШ — САНГИЙН ЖАГСААЛТЫН асуулт.  Хариу нь ажилтны
 *    PC-ийн `ai_documents`-д аль хэдийн байгаа; хайх юм алга, ЖАГСААХ л хэрэгтэй.
 *    Мөн «УББ 12-01-01 юуны тухай вэ?» гэхэд BM25 санамсаргүй 5 заалт `supported`
 *    гэж буцаадаг байв — баримтын БҮТЭЦ (бүлэг, заалтын муж, хүснэгт, хавсралт) нь
 *    `section_path`-д байгаа, тэр нь л «юуны тухай»-н үнэн хариу.
 *
 * ⚠️ СЕРВЕР ШИЙДНЭ, ХӨТӨЧ ТЭЭВЭРЛЭНЭ (`tool_results`, `norm_answer`-ийн ижил загвар).
 *    `/plan` нь `ask_norm_catalog: {code}` буцаана → хөтөч ажилтны PC-ийн
 *    `POST /norm/catalog`-ыг дуудна → `/context` энд ариутгаж, хэрэгслийн хайрцаг
 *    (`norm_catalog` синтетик хэрэгсэл — `revit_selection`-ийн ижил зам) + детерминист
 *    template болгоно.  Загвар зөвхөн НАЙРУУЛНА; код, нэр, тоо, төлөв — хайрцгаас.
 *
 * ⚠️ ЯАГААД META, НОРМ БИШ.  `regulatory=true` бол `buildTrustedContract` нотолгоогүй
 *    норм гэж татгалзлын гэрээ бичнэ (`answerMode: refusal`), `groundingGuard` түүнийг
 *    хөнддөггүй → жагсаалт хэзээ ч гарахгүй.  META + синтетик хэрэгсэл бол guard-ын 3-р
 *    салаа `grounded` + хайрцгийн тоо болгоно — яг хэрэгтэй гэрээ.  `isNormativeQuestion`
 *    ч эдгээрт `false` — эс тэгвэл `turnPlan.looksRegulatory` дахин хатуу горим асаана.
 *
 * ⚠️ ЦЭВЭР — D1-гүй, `normCatalog.test.ts`-ээр хэмжигдэнэ.
 */
import { currentnessLabel, currentnessNote, currentnessOf, type Currentness } from './currentness';
import { normalizeLatinMongolian } from './lang';
import { sanitizeFence, type ToolOutcome } from './promptFrame';
import type { TrustedContract, TrustedFact } from './trustedFacts';

/* ================================================================== */
/*  1. Асуулт таних                                                    */
/* ================================================================== */

/**
 * `rank` (2026-09-28, эзний бодит чат «hamgiin hetsuu norm durmiin jagsaaltiig beltge»): «хамгийн хэцүү/төвөгтэй/том»
 * гэсэн ҮНЭЛГЭЭНИЙ жагсаалт.  Өмнө нь олох асуулт болж, сэдэв олдоогүй тул «энэ төрлийн барилгад норм санд алга» гэсэн
 * ХАМААРАЛГҮЙ хариулт гарсан.  Хэцүү байдлыг хэмжих албан үзүүлэлт байхгүй — `size` нь санд буй баримтыг ХЭМЖЭЭГЭЭР
 * (заалт + хүснэгтийн мөр) эрэмбэлж, энэ нь орлуулга гэдгийг ил хэлнэ; `judgement` («хамгийн чухал/сайн») нь эрэмбэлэхгүй,
 * яагаад эрэмбэлж чадахгүйгээ хэлээд жагсаалт өгнө.
 */
export type NormCatalogAsk = { kind: 'inventory'; rank?: 'size' | 'judgement' } | { kind: 'document'; code: string };

const RANK_SIZE =
  /(?<!\p{L})(?:хамгийн|hamgiin|hamgin)\s+(?:хэцүү|хүнд|төвөгтэй|нарийн|нарийвчилсан|том|урт|их\s+заалттай|hetsuu|hetsu|hecuu|hecu|hund|tuvugtei|tovogtei|nariin|tom|urt)(?!\p{L})|(?<!\p{L})(?:hardest|most\s+(?:difficult|complex|complicated|detailed)|largest|longest|biggest)(?!\p{L})/iu;
const RANK_JUDGE =
  /(?<!\p{L})(?:хамгийн|hamgiin|hamgin)\s+(?:чухал|шилдэг|сайн|хэрэгтэй|түгээмэл|их\s+хэрэглэгддэг|chuhal|shildeg|sain|heregtei|tugeemel)(?!\p{L})|(?<!\p{L})(?:most\s+(?:important|useful|common|used)|best)(?!\p{L})/iu;
/** Үнэлгээний жагсаалтын хүсэлтийн ҮЙЛ ҮГ, зэрэг үг — сэдэв биш (угтвараар). */
const RANK_DROP: readonly RegExp[] = [
  /^(хамгийн|hamgiin|hamgin|most|the)$/i,
  /^(хэцүү|хүнд|төвөгтэй|нарийн|нарийвчилсан|том|урт|чухал|шилдэг|сайн|хэрэгтэй|түгээмэл|hetsu|hecu|hund|tuvugtei|tovogtei|nariin|tom|urt|chuhal|shildeg|sain|heregtei|tugeemel|hardest|difficult|complex|complicated|detailed|largest|longest|biggest|important|useful|common|used|best)/i,
  /^(жагсаа|бэлд|бэлтг|гарга|өг|хэл|бич|нэрл|тоочи|jagsaa|beld|beltg|garga|og|ug|hel|bich|nerl|toochi|list|prepare|make|give|show|name|rank)/i,
  /^(их|заалттай|хэрэглэгддэг|ih|zaalttai|nuud|nüüd|uud)$/i,
];

/** Нормын нэгжийг заасан нэр үг (кирилл + латин галиг + англи). */
const NORM_NOUN =
  /(?<!\p{L})(норм|стандарт|дүрэм|дүрм|бнбд|убб|снип|баримт|бичиг|мэдлэг|сан|norm|normuud|normiin|standart|durem|durmuud|durmiin|barimt|medleg|bnbd|ubb|snip|regulation|standard|code|document|knowledge)/iu;
/** Жагсаалт асуусан хүрээ — «ямар», «хэдэн», «аль», «бүх», «жагсаа». */
const FRAME =
  /(?<!\p{L})(ямар|хэдэн|хэд|аль|бүх|бүгд|жагсаа|жагсаалт|тоочи|нэрлэ|ymar|yamar|heden|hed|ali|buh|bugd|jagsaa|jagsaalt|toochi|nerle|list|which|what|how many|enumerate|name)(?!\p{L})/iu;
/** Эзэмшил/мэдлэг — «байгаа», «мэддэг», «суусан», «know», «have». */
const HAVE =
  /(?<!\p{L})(байгаа|байна|бий|байдаг|мэддэг|мэдэх|мэднэ|мэдэж|суусан|суулгасан|шингээсэн|шингэсэн|сурсан|орсон|ашигладаг|хэрэглэдэг|танил|уншсан|үзсэн|baigaa|baina|bga|bgaa|bii|baidag|meddeg|medeh|medne|medej|suusan|suulgasan|shingeesen|sursan|orson|ashigladag|know|knows|have|has|got|loaded|available|installed|contain|contains|cover|covers|trained|support)(?!\p{L})/iu;
/** Заалтын асуултын шинж — байвал жагсаалт БИШ, жинхэнэ норм (шаардлага, хамаарал, утга). */
const NOT_INVENTORY =
  /(?<!\p{L})(шаардлаг|хамаар|заасан|заана|зөвшөөр|ёстой|хэмжээ|хязгаар|талбай|өндөр|зай|гарц|гал|ачаалал|даац|зузаан|өргөн|тооц|ангил|хүснэгт|заалт|бүлэг|shaardlag|hamaar|zaasan|zovshoor|yostoi|hemjee|hyazgaar|talbai|undur|ondor|zai|garts|gal|achaalal|daats|zuzaan|urgun|toots|angil|husnegt|zaalt|bulag|require|apply|applies|clause|table|allowed|limit|minimum|maximum|distance|height|area)/iu;

/** Тайлбарлах хүрээ — «юуны тухай», «агуулга», «танилцуул», «what is … about». */
const OVERVIEW =
  /(юуны тухай|юу тухай|юуны талаар|юуны тухай баримт|ямар баримт|ямар дүрэм|ямар норм|ямар стандарт|юуг зохицуул|юуг заа|агуулг|бүтэц|бүтц|танилцуул|тайлбарла|тайлбар өг|ерөнхийд|ерөнхий агуулг|товчхон|товчил|товч|хураангуй|юу заасан|юу гэж заасан|юу гэж бичсэн|юу бичсэн|юу гэж байна|юу байна|гэж юу вэ|юу вэ|yunii tuhai|yuni tuhai|yuunii tuhai|yunii talaar|aguulg|butets|tanilcuul|tailbarla|tovch|huraangui|yu zaasan|yu gej zaasan|gej yu ve|yu ve|what is .*about|what does .*(cover|say|contain)|overview|summar|describe|explain|about)/iu;

/**
 * Баримтын код — `intent.ts`-ийн нотацитай ИЖИЛ гэр бүл, гэвч энд КОДЫГ ӨӨРИЙГ НЬ авна.
 * Угтвар (БНбД/БД/УББ/СНиП/MNS) + 2-3-2 дугаар; угтваргүй 2-3-2 (21-101-12) ч код.
 * СНиП II-97-76 хэлбэр тусдаа.
 */
const CODE_RE =
  /(?:(бнбд|бд|убб|снип|mns|мнс|bnbd|bd|ubb|snip)\s*-?\s*)?(ii-\d{2}-\d{2}\*?|\d{2}-\d{2,3}-\d{2}\*?)(?!\d)/giu;

const STOP = new Set(
  (
    'вэ бэ уу үү юу ч л нь бол чи чамд танд та таны чиний өөрт өөртөө одоо дотор дээр тухай талаар байх энэ тэр гэж гэсэн гэдэг ' +
    'миний бидэнд манай хэр хэрхэн яаж ямар ve be uu chi chamd tand ta tanii chinii oort odoo dotor deer tuhai talaar ene ter gej gesen yu yuu yun ch l ni bol ' +
    'do you your the a an are is in of there and or any me us it its this that all please tell show give us can could would ' +
    'ai туслах систем sistem system санд sand knowledge база base мэдэх'
  ).split(/\s+/),
);

function norm(q: string): string {
  const raw = (q ?? '').toLowerCase();
  return `${raw} ${normalizeLatinMongolian(raw).toLowerCase()}`;
}

/** Хүрээ/эзэмшил/нэр үг/зогсоох үгээс ӨӨР агуулгын үг үлдэж байна уу — үлдвэл сэдэвтэй асуулт. */
function contentTokens(text: string, extraDrop: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const tok of text.split(/[^\p{L}\p{N}-]+/u)) {
    const t = tok.replace(/^-+|-+$/g, '');
    if (t.length < 2 || STOP.has(t) || /^\d+$/.test(t)) continue;
    if (NORM_NOUN.test(` ${t}`) || FRAME.test(` ${t} `) || HAVE.test(` ${t} `)) continue;
    if (extraDrop.some((re) => re.test(t))) continue;
    out.push(t);
  }
  return out;
}

/** Асуултаас нэрлэсэн кодыг канон хэлбэрт («УББ 12-01-01», «БНбД 21-04-05», «СНиП II-97-76»). */
export function extractNormCode(question: string): string | null {
  const raw = (question ?? '').toLowerCase();
  CODE_RE.lastIndex = 0;
  const m = CODE_RE.exec(raw);
  if (!m) return null;
  const prefix = (m[1] ?? '').toLowerCase();
  const num = m[2]!.toUpperCase();
  const PREFIX: Record<string, string> = { бнбд: 'БНбД', bnbd: 'БНбД', бд: 'БД', bd: 'БД', убб: 'УББ', ubb: 'УББ', снип: 'СНиП', snip: 'СНиП', mns: 'MNS', мнс: 'MNS' };
  const p = PREFIX[prefix] ?? (num.startsWith('II-') ? 'СНиП' : '');
  return p ? `${p} ${num}` : num;
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Асуулт нь сангийн ЖАГСААЛТ («ямар норм байгаа вэ») эсвэл нэг баримтын
 * ТОЙМ («УББ 12-01-01 юуны тухай вэ») асуусан уу.  Аль нь ч биш бол `null` — ердийн зам.
 *
 * Жагсаалт = нормын нэр үг + хүрээ/эзэмшил + сэдвийн үг БАЙХГҮЙ.  «Сургуулийн барилгад
 * ямар норм байгаа вэ» → «сургуулийн», «барилгад» үлдэнэ → null (тэр нь чиглүүлэгчийн
 * асуулт, жагсаалт биш).  Тойм = код + тайлбарлах хүрээ + сэдвийн үг байхгүй.
 * «БНбД 21-04-05-д галын дохиоллын тухай юу заасан бэ» → «галын», «дохиоллын» → null.
 */
export function detectNormCatalogAsk(question: string): NormCatalogAsk | null {
  const q = norm(question);
  if (q.trim().length === 0) return null;
  const code = extractNormCode(question);

  if (code !== null) {
    if (!OVERVIEW.test(q)) return null;
    const rest = contentTokens(q.replace(CODE_RE, ' '), [
      /^(бнбд|бд|убб|снип|mns|мнс|bnbd|ubb|snip|ii)$/i,
      // Кодын араас салсан залгавар («21-101-12-ийн» → «ийн»).
      /^(ийн|ын|ний|ны|ийг|ыг|тай|тэй|той|аар|ээр|оор|өөр|аас|ээс|оос|өөс|дахь|дэх|iin|in|ii|iig|ig|tai|tei|aar|eer|aas|ees|dahi|deh|d|t)$/i,
      // Тайлбарлах хүрээний үгс — УГТВАРААР («танилцуулаач», «агуулгыг», «тайлбарлаад» бүгд орно).
      /^(юуны|юуг|зохицуул|агуулг|бүтэц|бүтц|танилцуул|тайлбарла|тайлбар|ерөнхий|товч|хураангуй|заасан|бичсэн|байна|yunii|yuni|yuunii|aguulg|butets|tanilcuul|tailbarla|tovch|huraangui|zaasan|overview|summar|describe|explain|about|say|cover|contain|does|what)/i,
      /^(баримт|баримтын|дүрэм|дүрмийн|норм|нормын|стандарт|стандартын)$/i,
    ]);
    return rest.length === 0 ? { kind: 'document', code } : null;
  }

  if (!NORM_NOUN.test(q)) return null;
  // Үнэлгээний жагсаалт — сэдвийн үг үлдээгүй бол («хамгийн хэцүү норм», «хамгийн гал…» биш).
  const rank: 'size' | 'judgement' | null = RANK_SIZE.test(q) ? 'size' : RANK_JUDGE.test(q) ? 'judgement' : null;
  if (rank !== null && !NOT_INVENTORY.test(q)) {
    const rest = contentTokens(q, RANK_DROP);
    if (rest.length === 0) return { kind: 'inventory', rank };
  }
  if (NOT_INVENTORY.test(q)) return null;
  if (!FRAME.test(q) && !HAVE.test(q)) return null;
  // Хүрээ ч, эзэмшил ч байхгүй бол («нормын сан») асуулт биш, нэр л.
  if (!FRAME.test(q) && !/\?/.test(question) && !/(вэ|бэ|уу|үү|ve|be)\s*\??\s*$/iu.test(q.trim())) return null;
  const rest = contentTokens(q, []);
  return rest.length === 0 ? { kind: 'inventory' } : null;
}

/* ================================================================== */
/*  2. Хөтчөөс ирсэн каталогийг АРИУТГАХ (цагаан жагсаалт)             */
/* ================================================================== */

export interface CatalogDoc {
  code: string;
  titleMn: string;
  titleEn: string | null;
  effectiveStatus: string;
  currentness: Currentness;
  pages: number;
  authority: string | null;
  orderDate: string | null;
  orderNumber: string | null;
  effectiveFrom: string | null;
  sourceUrl: string | null;
  chunks: number;
  clauses: number;
  tableRows: number;
  rules: number;
}

export interface CatalogSection {
  path: string;
  n: number;
  clauseFrom: string | null;
  clauseTo: string | null;
  kind: 'clauses' | 'tables' | 'mixed' | 'other';
}

export type NormCatalog =
  | { kind: 'inventory'; documents: CatalogDoc[]; counts: { documents: number; chunks: number; rules: number; aliases: number }; registry: { norms: number; active: number; candidate: number; draft: number } | null }
  | { kind: 'document'; document: CatalogDoc; sections: CatalogSection[]; sectionsTotal: number; appendices: string[]; tables: string[] }
  | { kind: 'not_found'; code: string; registry: { code: string; titleMn: string; status: string; sourceUrl: string | null } | null };

const MAX_DOCS = 60;
const MAX_SECTIONS = 48;
const MAX_LIST = 24;

function s(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? sanitizeFence(v.trim().slice(0, max)) : null;
}
function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}
function https(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/[^\s"'<>]{1,300}$/.test(v) ? v : null;
}
function strList(v: unknown, max: number, len: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, max).map((x) => sanitizeFence(x.trim().slice(0, len))) : [];
}

function doc(raw: unknown): CatalogDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = s(r.code, 64);
  const titleMn = s(r.title_mn, 240);
  if (!code || !titleMn) return null;
  const effectiveStatus = s(r.effective_status, 80) ?? '';
  return {
    code,
    titleMn,
    titleEn: s(r.title_en, 240),
    effectiveStatus,
    currentness: currentnessOf(effectiveStatus),
    pages: n(r.pages),
    authority: s(r.authority, 160),
    orderDate: s(r.order_date, 10),
    orderNumber: s(r.order_number, 20),
    effectiveFrom: s(r.effective_from, 10),
    sourceUrl: https(r.source_url),
    chunks: n(r.chunks),
    clauses: n(r.clauses),
    tableRows: n(r.table_rows),
    rules: n(r.rules),
  };
}

export function parseNormCatalog(raw: unknown): NormCatalog | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'inventory') {
    const documents = Array.isArray(r.documents) ? r.documents.map(doc).filter((d): d is CatalogDoc => d !== null).slice(0, MAX_DOCS) : [];
    const c = (r.counts ?? {}) as Record<string, unknown>;
    const g = r.registry && typeof r.registry === 'object' ? (r.registry as Record<string, unknown>) : null;
    return {
      kind: 'inventory',
      documents,
      counts: { documents: n(c.documents) || documents.length, chunks: n(c.chunks), rules: n(c.rules), aliases: n(c.aliases) },
      registry: g && n(g.norms) > 0 ? { norms: n(g.norms), active: n(g.active), candidate: n(g.candidate), draft: n(g.draft) } : null,
    };
  }
  if (r.kind === 'document') {
    const document = doc(r.document);
    if (!document) return null;
    const sections: CatalogSection[] = [];
    if (Array.isArray(r.sections)) {
      for (const x of r.sections.slice(0, MAX_SECTIONS)) {
        if (!x || typeof x !== 'object') continue;
        const o = x as Record<string, unknown>;
        const path = s(o.path, 160);
        if (!path) continue;
        const kind = o.kind === 'clauses' || o.kind === 'tables' || o.kind === 'mixed' ? o.kind : 'other';
        sections.push({ path, n: n(o.n), clauseFrom: s(o.clause_from, 16), clauseTo: s(o.clause_to, 16), kind });
      }
    }
    return {
      kind: 'document',
      document,
      sections,
      sectionsTotal: Math.max(n(r.sections_total), sections.length),
      appendices: strList(r.appendices, MAX_LIST, 80),
      tables: strList(r.tables, MAX_LIST, 120),
    };
  }
  if (r.kind === 'not_found') {
    const code = s(r.code, 64);
    if (!code) return null;
    const g = r.registry && typeof r.registry === 'object' ? (r.registry as Record<string, unknown>) : null;
    const gc = g ? s(g.code, 64) : null;
    const gt = g ? s(g.title_mn, 240) : null;
    return { kind: 'not_found', code, registry: gc && gt ? { code: gc, titleMn: gt, status: s(g!.status, 40) ?? 'UNKNOWN', sourceUrl: https(g!.source_url) } : null };
  }
  return null;
}

/* ================================================================== */
/*  3. Хэрэгслийн хайрцаг + детерминист template                        */
/* ================================================================== */

export const NORM_CATALOG_TOOL = 'norm_catalog';

/** Нэг баримтын мөр — хайрцагт (загварт) очих ХЭЛБЭР; тоо, төлөв бүгд эндээс. */
function docBox(d: CatalogDoc, lang: 'mn-Cyrl' | 'en') {
  return {
    code: d.code,
    title: lang === 'en' && d.titleEn ? d.titleEn : d.titleMn,
    status: currentnessLabel(d.currentness, lang),
    clauses: d.clauses,
    table_rows: d.tableRows,
    approved: d.orderDate ? `${d.orderDate}${d.orderNumber ? ` №${d.orderNumber}` : ''}` : null,
    effective_from: d.effectiveFrom,
    source_url: d.sourceUrl,
  };
}

/** `/context`-ийн синтетик хэрэгсэл — `renderToolResults` хайрцаглана, `groundingGuard` тоог зөвшөөрнө. */
export function normCatalogTool(c: NormCatalog, lang: 'mn-Cyrl' | 'en'): ToolOutcome {
  if (c.kind === 'inventory') {
    return {
      tool: NORM_CATALOG_TOOL,
      ok: true,
      data: {
        kind: 'inventory',
        note:
          lang === 'en'
            ? `Documents ingested in the local norm knowledge base on this PC. Answer with a list of ALL ${c.documents.length} documents, one line each as «• code — title (status)»; do not summarise, do not add any other document.`
            : `Энэ компьютерийн локал нормын санд шингээсэн баримтууд. Хариултад ${c.documents.length} баримтыг БҮГДИЙГ нь «• код — нэр (төлөв)» гэсэн тусдаа мөрөөр жагсаа; нэгтгэж товчлохгүй, өөр баримт нэмэхгүй.`,
        count: c.documents.length,
        documents: c.documents.map((d) => docBox(d, lang)),
        registry_links_only: c.registry ? { norms: c.registry.norms, active: c.registry.active } : null,
      },
    };
  }
  if (c.kind === 'document') {
    return {
      tool: NORM_CATALOG_TOOL,
      ok: true,
      data: {
        kind: 'document',
        note: lang === 'en' ? 'Structure of ONE document: chapters and clause ranges only. Do not invent clause contents.' : 'НЭГ баримтын бүтэц: бүлэг, заалтын муж л. Заалтын агуулга ЗОХИОХГҮЙ.',
        document: { ...docBox(c.document, lang), authority: c.document.authority, pages: c.document.pages },
        chapters_count: c.sectionsTotal,
        chapters: c.sections.map((sec) => ({ title: sec.path, clauses: sec.clauseFrom && sec.clauseTo ? (sec.clauseFrom === sec.clauseTo ? sec.clauseFrom : `${sec.clauseFrom}–${sec.clauseTo}`) : null, items: sec.n })),
        tables: c.tables,
        appendices: c.appendices,
      },
    };
  }
  return {
    tool: NORM_CATALOG_TOOL,
    ok: true,
    data: {
      kind: 'not_found',
      code: c.code,
      note: lang === 'en' ? 'This document is NOT in the local knowledge base. Say so; do not describe its contents.' : 'Энэ баримт локал санд БАЙХГҮЙ. Тэгж хэл; агуулгыг нь тайлбарлахгүй.',
      registry: c.registry ? { code: c.registry.code, title: c.registry.titleMn, status: c.registry.status, source_url: c.registry.sourceUrl } : null,
    },
  };
}

/** Хайрцаг ирээгүй (runtime унтарсан / сан суулгаагүй) үеийн ИЛ мэдэгдэл — хэзээ ч зохиохгүй. */
export function normCatalogUnavailableTool(reason: string, lang: 'mn-Cyrl' | 'en'): ToolOutcome {
  const mn: Record<string, string> = {
    runtime_down: 'MGL AI runtime энэ компьютерт ажиллахгүй байна — нормын сангийн жагсаалтыг уншиж чадсангүй.',
    not_installed: 'Нормын сан энэ компьютерт суулгаагүй байна.',
    timeout: 'Нормын сангийн жагсаалт хугацаанд ирсэнгүй.',
    offline: 'Нормын санд холбогдож чадсангүй.',
    error: 'Нормын сангийн жагсаалтыг уншиж чадсангүй.',
  };
  const en: Record<string, string> = {
    runtime_down: 'The MGL AI runtime is not running on this PC — the norm knowledge base list could not be read.',
    not_installed: 'The norm knowledge base is not installed on this PC.',
    timeout: 'The knowledge base list did not arrive in time.',
    offline: 'Could not reach the norm knowledge base.',
    error: 'The knowledge base list could not be read.',
  };
  return { tool: NORM_CATALOG_TOOL, ok: false, data: null, error: (lang === 'en' ? en : mn)[reason] ?? (lang === 'en' ? en.error : mn.error) };
}

/**
 * Каталог ИРЭЭГҮЙ (runtime унтарсан / сан суулгаагүй / хугацаа) үеийн гэрээ — `groundingGuard`-ын
 * «ERP амьд өгөгдөл татаж чадсангүй» өгүүлбэр нормын санд ХАМААРАХГҮЙ тул нормын үгээр солино.
 * Татгалзал хэвээр: жагсаалт санахуйгаас ЗОХИОГДОХГҮЙ.
 */
export function withNormCatalogUnavailable(contract: TrustedContract, reason: string, lang: 'mn-Cyrl' | 'en'): TrustedContract {
  const t = normCatalogUnavailableTool(reason, lang);
  const sentence = t.error ?? '';
  const tail = lang === 'en' ? ' Start the MGL AI runtime on this PC (or install the knowledge base) and ask again.' : ' Энэ компьютер дээр MGL AI runtime-ийг асаагаад (эсвэл нормын санг суулгаад) дахин асуугаарай.';
  return {
    ...contract,
    answerMode: 'refusal',
    risk: 'high',
    allowedNumbers: [],
    allowedCategories: contract.allowedCategories ?? [],
    requiredSentence: sentence,
    template: sentence + tail,
    templateOnly: true,
    noMatch: true,
    reason: `${contract.reason} · norm_catalog:unavailable(${reason})`,
  };
}

/** Хэрэгслийн хайрцгийн дүрмийн мөр — `renderToolResults`-д `norm_catalog` байхад. */
export function normCatalogBoxRule(lang: 'mn-Cyrl' | 'en'): string {
  return lang === 'en'
    ? 'rule (norm_catalog): this is the assistant\'s OWN knowledge-base list. Name every document with its code and title, take status/approval/counts ONLY from the box, never add a document that is not in it, never invent clause contents; for a single document, walk its chapters in order.'
    : 'дүрэм (norm_catalog): энэ бол туслахын ӨӨРИЙН мэдлэгийн сангийн жагсаалт. kind=inventory бол documents-ийн баримт БҮРИЙГ «• код — нэр (төлөв)» гэсэн ТУСДАА мөрөөр жагсаа (count мөр), нэг өгүүлбэрт нэгтгэж товчлохгүй; kind=document бол chapters-ийг дарааллаар нь тоочно. Төлөв, батлагдсан огноо, тоог ЗӨВХӨН хайрцгаас; хайрцагт байхгүй баримт НЭМЭХГҮЙ, заалтын агуулга ЗОХИОХГҮЙ.';
}

function statusWord(d: CatalogDoc, lang: 'mn-Cyrl' | 'en'): string {
  return currentnessLabel(d.currentness, lang).toLowerCase();
}

/**
 * ДЕТЕРМИНИСТ ХАРИУЛТ — загвар гэрээ зөрчвөл хөтөч үүнийг харуулна (§7, §39).
 * «Зөв атлаа хатуу монгол» нь «уран атлаа зохиомол»-оос дээр.
 */
export function normCatalogTemplate(c: NormCatalog, lang: 'mn-Cyrl' | 'en', ask: NormCatalogAsk | null = null): string {
  const en = lang === 'en';
  if (c.kind === 'inventory') {
    if (c.documents.length === 0) return en ? 'No normative documents are ingested in the local knowledge base on this PC yet.' : 'Энэ компьютерийн локал нормын санд одоогоор шингээсэн баримт алга.';
    const rank = ask?.kind === 'inventory' ? (ask.rank ?? null) : null;
    // «Хамгийн хэцүү» — хэмжих албан үзүүлэлт АЛГА; орлуулга нь хэмжээ (заалт + хүснэгтийн мөр) гэдгийг ил хэлнэ.
    const docs = rank === 'size' ? [...c.documents].sort((a, b) => b.clauses + b.tableRows - (a.clauses + a.tableRows) || (a.code < b.code ? -1 : 1)) : c.documents;
    const rankNote =
      rank === 'size'
        ? en
          ? 'There is no official measure of how "difficult" a norm is, so I cannot rank them by difficulty. As a stand-in, here are the norms in the knowledge base ordered by SIZE — number of clauses and table rows (more usually means more detailed requirements):'
          : '«Хэцүү» гэдгийг хэмжих албан үзүүлэлт байхгүй тул нормыг хэцүү, хялбараар нь эрэмбэлж чадахгүй. Оронд нь санд буй нормуудыг ХЭМЖЭЭГЭЭР — заалт, хүснэгтийн мөрийн тоогоор (олон байх нь ихэвчлэн шаардлага нь нарийн гэсэн үг) эрэмбэлэв:'
        : rank === 'judgement'
          ? en
            ? 'Which norm matters most depends on your building type and the work, so I cannot rank them in general. These are the norms in the knowledge base:'
            : 'Аль норм хамгийн чухал вэ гэдэг нь таны барилгын төрөл, хийж буй ажлаас хамаардаг тул ерөнхийд нь эрэмбэлж чадахгүй. Санд буй нормууд:'
          : null;
    const head = rankNote ?? (en
      ? `The local knowledge base on this PC holds ${c.documents.length} normative documents:`
      : `Энэ компьютерийн нормын санд ${c.documents.length} баримт шингээсэн байна:`);
    const lines = docs.map((d, i) => {
      const title = en && d.titleEn ? d.titleEn : d.titleMn;
      const bits = [
        d.clauses > 0 ? (en ? `${d.clauses} clauses` : `${d.clauses} заалт`) : null,
        d.tableRows > 0 ? (en ? `${d.tableRows} table rows` : `${d.tableRows} хүснэгтийн мөр`) : null,
        statusWord(d, lang),
      ].filter((x): x is string => x !== null);
      return `${rank === 'size' ? `${i + 1}.` : '•'} ${d.code} — ${title} (${bits.join(', ')})`;
    });
    if (rank !== null) {
      lines.push(
        en
          ? 'Tell me the building type or topic (fire, electrical, loads…) and I will list the norms that apply to it.'
          : 'Барилгын төрөл эсвэл сэдвээ (гал, цахилгаан, ачаалал …) хэлбэл тэр чиглэлийн нормуудыг жагсааж өгье.',
      );
    }
    const tail = c.registry
      ? en
        ? `Beyond these, the registry lists ${c.registry.norms} norms by code, title and status only (${c.registry.active} in force) — for those I can give the official link, not the clauses.`
        : `Үүнээс гадна бүртгэлд ${c.registry.norms} нормын код, нэр, төлөв бий (${c.registry.active} нь хүчин төгөлдөр) — тэдгээрийн заалтыг биш, албан холбоосыг нь л өгч чадна.`
      : en
        ? 'I answer clause-level questions only from these documents; anything else I say plainly is not in the knowledge base.'
        : 'Заалтын түвшний асуултад зөвхөн эдгээр баримтаас хариулна; бусад асуултад санд байхгүй гэдгийг шууд хэлнэ.';
    return [head, ...lines, tail].join('\n');
  }
  if (c.kind === 'document') {
    const d = c.document;
    const title = en && d.titleEn ? d.titleEn : d.titleMn;
    const approved = d.orderDate ? (en ? ` Approved ${d.orderDate}${d.orderNumber ? ` (order №${d.orderNumber})` : ''}${d.authority ? ` by ${d.authority}` : ''}.` : ` ${d.authority ? `${d.authority}, ` : ''}${d.orderDate}${d.orderNumber ? `, №${d.orderNumber} тушаалаар` : ''} батлагдсан.`) : '';
    const eff = d.effectiveFrom ? (en ? ` In effect from ${d.effectiveFrom}.` : ` ${d.effectiveFrom}-аас мөрдөнө.`) : '';
    const head = en
      ? `${d.code} «${title}» — ${statusWord(d, lang)}.${approved}${eff} The knowledge base holds ${d.clauses} clauses${d.tableRows > 0 ? ` and ${d.tableRows} table rows` : ''} of it.`
      : `${d.code} «${title}» — ${statusWord(d, lang)}.${approved}${eff} Санд энэ баримтын ${d.clauses} заалт${d.tableRows > 0 ? `, ${d.tableRows} хүснэгтийн мөр` : ''} шингэсэн.`;
    const chapters = c.sections.filter((x) => x.kind !== 'other' || /^\d/.test(x.path));
    const lines = chapters.map((x) => {
      const range = x.clauseFrom && x.clauseTo ? (x.clauseFrom === x.clauseTo ? ` (${en ? 'clause' : 'заалт'} ${x.clauseFrom})` : ` (${en ? 'clauses' : 'заалт'} ${x.clauseFrom}–${x.clauseTo})`) : '';
      return `• ${x.path}${range}`;
    });
    const more = c.sectionsTotal > c.sections.length ? [en ? `… and ${c.sectionsTotal - c.sections.length} more chapters.` : `… мөн ${c.sectionsTotal - c.sections.length} бүлэг.`] : [];
    const tables = c.tables.length > 0 ? [en ? `Tables: ${c.tables.join('; ')}.` : `Хүснэгтүүд: ${c.tables.join('; ')}.`] : [];
    const app = c.appendices.length > 0 ? [en ? `Appendices: ${c.appendices.join(', ')}.` : `Хавсралтууд: ${c.appendices.join(', ')}.`] : [];
    // Төлөвийн тэмдэглэл ЭНД ОРОХГҮЙ — `withNormCatalog` түүнийг `trailerText` болгодог, validator
    //    fallback-д трейлерийг өөрөө залгадаг (өмнө нь давхардаж хоёр удаа гарч байв, хэмжсэн).
    return [head, ...(lines.length > 0 ? [en ? 'Structure:' : 'Бүтэц:', ...lines] : []), ...more, ...tables, ...app].join('\n');
  }
  const reg = c.registry
    ? en
      ? ` The registry lists it as «${c.registry.titleMn}» (${c.registry.status})${c.registry.sourceUrl ? `; official source: ${c.registry.sourceUrl}` : ''} — I can point to it but cannot cite its clauses.`
      : ` Бүртгэлд «${c.registry.titleMn}» (${c.registry.status}) гэж бий${c.registry.sourceUrl ? `; албан эх сурвалж: ${c.registry.sourceUrl}` : ''} — зааж өгч чадна, заалтыг нь эшлэж чадахгүй.`
    : '';
  return en
    ? `${c.code} is not in the local knowledge base on this PC, so I cannot describe its contents.${reg}`
    : `${c.code} энэ компьютерийн нормын санд шингээгээгүй тул агуулгыг нь тайлбарлах боломжгүй.${reg}`;
}

/**
 * Гэрээг каталогт тааруулна — `applyGroundingGuard`-ын ДАРАА: guard нь синтетик хэрэгслийн
 * тоог зөвшөөрч `grounded` болгосон байна; энд template-ийг JSON-хайрцгаас ХҮНИЙ хэлбэр
 * болгож, нэг баримтын тоймд эх сурвалжийн төлөвийн тэмдэглэлийг trailer болгоно.
 * Бүртгэлд ч, санд ч байхгүй баримтад `noMatch` — «БНбД X-д заасан» гэж эшлэл зохиохгүй.
 */
const MUST_MENTION_MAX = 15;

export function withNormCatalog(contract: TrustedContract, c: NormCatalog, lang: 'mn-Cyrl' | 'en', ask: NormCatalogAsk | null = null): TrustedContract {
  const template = normCatalogTemplate(c, lang, ask);
  const trailer = c.kind === 'document' ? currentnessNote(c.document.currentness, lang) : null;
  // Жагсаалтад баримт БҮР дурдагдах ёстой — загвар 11-ийг 2 болгож тайрдаг (хэмжсэн).  Дутуу бол
  //    validator дутуу кодуудыг мөрөөр нэмнэ (FACT_MISSING); дэндүү олон бол template л бүрэн.
  const docFacts: TrustedFact[] =
    c.kind === 'inventory' && c.documents.length <= MUST_MENTION_MAX
      ? c.documents.map((d, i) => ({ id: `catalog_doc_${i}`, kind: 'text', value: d.code, labelMn: 'Баримт', labelEn: 'Document', authority: 'retrieval', mustMention: true }))
      : c.kind === 'not_found'
        ? // Санд байхгүй баримт: загвар канон өгүүлбэрийг ЯГ давтахгүй бол template (хэмжсэн 2026-09-18, прод:
          //   «БНбД 41-01-11 … архитектур, галт огтлолын зөвхөн хэмжээний дүрэм» гэж агуулгыг ЗОХИОСОН).
          [{ id: 'catalog_doc_absent', kind: 'text', value: template.split('\n')[0]!, labelMn: 'Санд байхгүй', labelEn: 'Not in knowledge base', authority: 'retrieval', mustMention: true }]
      : c.kind === 'document'
        ? [
            { id: 'catalog_doc', kind: 'text', value: c.document.code, labelMn: 'Баримт', labelEn: 'Document', authority: 'retrieval', mustMention: true },
            // Бүлгийн гарчиг бүр — загвар ихэнхийг нь орхивол (богино адаптер) template = бүтэн бүтэц.
            ...c.sections
              .filter((x) => x.kind !== 'other')
              .slice(0, MUST_MENTION_MAX)
              .map((x, i) => ({ id: `catalog_doc_sec_${i}`, kind: 'text' as const, value: x.path.replace(/^\d+(?:\.\d+)*\.?\s*/, '').replace(/^\S+\.\s+/, ''), labelMn: 'Бүлэг', labelEn: 'Chapter', authority: 'retrieval' as const, mustMention: true })),
          ]
        : [];
  return {
    ...contract,
    facts: [...contract.facts, ...docFacts],
    answerMode: contract.answerMode === 'free' ? 'grounded' : contract.answerMode,
    risk: contract.risk === 'low' ? 'medium' : contract.risk,
    template,
    trailerText: contract.trailerText ?? trailer,
    noMatch: c.kind === 'not_found' && c.registry === null,
    forbiddenPhrases: c.kind === 'not_found' ? [...contract.forbiddenPhrases, 'гэдэг нь', 'тухай дүрэм', 'зохицуулдаг', 'заасан байдаг', 'is a regulation', 'regulates'] : contract.forbiddenPhrases,
    requiredCitations: c.kind === 'document' ? [...new Set([...contract.requiredCitations, c.document.code])] : contract.requiredCitations,
    // ⚠️ ДЕТЕРМИНИСТ Л (`templateOnly`, `norm_documents`-тэй ижил): хэмжсэн — адаптер 0.4 11 баримтын
    //    жагсаалтыг «11 баримт байна» гэсэн нэг өгүүлбэр болгож, суурь загвар нэг кодыг буруу бичдэг.
    //    Жагсаалт/бүтэц бол өгөгдөл, найруулга биш; загвар оролцохгүй, /generate дуудагдахгүй.
    templateOnly: true,
    reason: `${contract.reason} · norm_catalog:${c.kind}`,
  };
}
