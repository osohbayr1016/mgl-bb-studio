/**
 * Revit-ээс ирсэн явцын МОНГОЛ ТЭМДЭГЛЭЛ үүсгэгч.
 *
 * ⚠️ ЗАГВАР ЭХЭНДЭЭ, AI ХОЙНО.  `templateNote()` нь цэвэр функц бөгөөд
 * ҮРГЭЛЖ ажиллана.  AI нь зөвхөн түүнийг УНШИМЖТАЙ БОЛГОХ оролдлого —
 * унавал, хоосон буцаавал, эсвэл шалгалт давахгүй бол загвар нь шууд очно.
 * Хэрэглэгч AI унасныг МЭДЭХГҮЙ, зөвхөн `fallback: true` талбараар л
 * ялгагдана.  Тэмдэглэл хэзээ ч хоосон гарахгүй.
 *
 * ⚠️ ХУВИЙН ТООГ AI ЗОХИОХ ЁСГҮЙ.  Хувь нь `revitProgress.ts`-д АЛЬ ХЭДИЙН
 * шийдэгдсэн байдаг; AI зөвхөн үг бичнэ.  Хэрэв AI-ийн бичвэрт бодит
 * хувиас ӨӨР `NN%` тэмдэглэгээ орвол бүхэлд нь хаяж загварыг авна —
 * тайлангийн тоо ба бичвэр хэзээ ч зөрөхгүй.
 *
 * ⚠️ Тэмдэглэл нь `progress_entries.notes` болж очно.  Тэр багана нь
 * `GET /api/projects/:id/activity` ба `GET /api/progress/task/:taskId`-ээр
 * дамжин НЭВТЭРСЭН ХЭРЭГЛЭГЧ БҮРТ харагддаг (аль нь ч гишүүнчлэлээр
 * хаагаагүй).  Нууц зүйл бичихгүй; панель үүнийг хэрэглэгчид сануулна.
 */
import type { Env } from '../types';

/** Загвар өөрчлөгдвөл ҮҮНИЙГ өсгө — аудит мөрөнд хадгалагдана. */
export const REVIT_NOTE_PROMPT_VERSION = 'revit-note-v2';

export const REVIT_NOTE_MODEL = '@cf/meta/llama-3.1-8b-instruct';

/**
 * Тэмдэглэлийн дээд урт — `notes` нь хязгааргүй ч уншимжтай байх ёстой.
 *
 * ⚠️ 2026-08-26-нд 600 → 900 болов.  Тэмдэглэл нь одоо «юуг, хаана, хэдийг»
 * гэсэн задаргаатай болсон тул 4-5 бүлэгтэй өдөр 600-д багтахгүй бөгөөд
 * тайрагдвал яг ХАМГИЙН ХЭРЭГТЭЙ хэсэг нь (сүүлийн бүлгүүд) алдагдана.
 */
export const MAX_NOTE_LENGTH = 900;

/** Загварын тэмдэглэлд задлан бичих бүлгийн дээд тоо. */
const MAX_TEMPLATE_GROUPS = 8;

export interface NoteFacts {
  projectName: string;
  taskName: string;
  /** Энэ илгээлтээр хамрагдсан хуудаснууд — «БА-01», «БА-02» … */
  sheetLabels: string[];
  previousPercent: number;
  percent: number;
  /** `deriveSuggestedPercent`-ийн тайлбар — «Checklist 8/13 → 62%». */
  basisDetail: string;
  /** Загварын өөрчлөлтийн товч тоо.  Байхгүй байж болно. */
  added?: number;
  modified?: number;

  /**
   * Утга учиртай элементийн тоо — дотоод/туслах элементүүдийг ХАССАН.
   *
   * ⚠️ `added`/`modified` нь Revit-ийн ТҮҮХИЙ тоо.  Нэг хана зөөхөд Revit
   * түүний эскиз, залгаа хана, өрөөний заагийг ч «өөрчлөгдсөн» гэж
   * мэдэгддэг тул тэр тоо 155 гарч, хүн 8 хана л зассан байдаг.  Тайланд
   * түүхий тоог бичих нь ХУДАЛ (эзний шийдвэр, 2026-08-26) — `groups`
   * байгаа үед `added`/`modified` тэмдэглэлд ОГТ ОРОХГҮЙ.
   */
  visibleTotal?: number;

  /** Өгүүлбэр угсрах бүтэцтэй баримтууд — add-in-ий `change_digest`-ээс. */
  groups?: ChangeGroupFact[];

  /** Багтаагүй бүлгийн тоо. */
  moreGroups?: number;
}

/**
 * Нэг НЭГТГЭГДСЭН бүлэг: категори × төрөл × давхар × үйлдэл → тоо, хуудас.
 *
 * Add-in дээрх `ChangeReport.ChangeDigest`-ийн гаралттай ХОСЛОЛ (twin).
 * Талбар нэмэхэд ХОЁУЛАНГ нь зэрэг өөрчил.
 */
export interface ChangeGroupFact {
  categoryLabel: string;
  typeName?: string | null;
  level?: string | null;
  /** added | modified | deleted */
  kind: string;
  kindLabel?: string | null;
  /** Revit-ийн үйлдлийн нэрс — «зөөсөн», «төрөл сольсон». */
  ops?: string[];
  count: number;
  /** Тухайн бүлгийн ажил ХАРАГДАХ хуудсууд.  Тогтоогдоогүй бол хоосон. */
  sheets?: string[];
}

/**
 * Бүлгийн үйл үг.  ⚠️ ХЭЛЗҮЙН ТЭГШИТГЭЛ ХИЙХГҮЙ.
 *
 * Давхар/хуудасны нэрийг («1-р давхар», «БА101») монгол тийн ялгалд оруулах
 * гэвэл «1-р давхарын» гэх мэт буруу хэлбэр гарна — нэр нь өгөгдлөөс ирдэг
 * тул ямар ч дүрэм найдваргүй.  Тиймээс загвар нь ТУСГААРЛАГЧ ашиглаж,
 * урсгал өгүүлбэрийг AI бичнэ (шийдвэр 2026-08-26).
 */
function verbFor(g: ChangeGroupFact): string {
  const n = g.count;
  const ops = (g.ops ?? []).map((o) => String(o ?? '').toLowerCase());

  if (g.kind === 'added') return `${n} ширхэг нэмэв`;
  if (g.kind === 'deleted') return `${n} ширхэгийг устгав`;
  if (ops.some((o) => o.includes('зөө'))) return `${n} ширхэгийн байрлалыг өөрчлөв`;
  if (ops.some((o) => o.includes('төрөл'))) return `${n} ширхэгийн төрлийг сольв`;
  return `${n} ширхэгийг зассан`;
}

/** «БА101 хуудас · 1-р давхар · Хана 200мм — 3 ширхэг нэмэв.» */
export function groupSentence(g: ChangeGroupFact): string {
  const where: string[] = [];

  const sheets = (g.sheets ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (sheets.length > 0) where.push(`${sheets.join(', ')} хуудас`);

  const level = String(g.level ?? '').trim();
  if (level) where.push(level);

  const what = String(g.typeName ?? '').trim() || String(g.categoryLabel ?? '').trim();
  if (what) where.push(what);

  const head = where.join(' · ');
  return head ? `${head} — ${verbFor(g)}.` : `${verbFor(g)}.`;
}

/** AI-ийн бичвэрт зөвшөөрөгдөх «N ширхэг» тоонууд. */
export function allowedCountsOf(f: NoteFacts): number[] {
  const set = new Set<number>();
  for (const g of f.groups ?? []) set.add(g.count);
  if (typeof f.visibleTotal === 'number') set.add(f.visibleTotal);
  return [...set];
}

/**
 * БАТАЛГААТАЙ тэмдэглэл — AI-гүйгээр.  Цэвэр функц, тестлэгдэнэ.
 * Хэзээ ч хоосон буцаахгүй.
 */
export function templateNote(f: NoteFacts): string {
  const parts: string[] = [];

  const project = f.projectName.trim();
  const task = f.taskName.trim();
  if (project && task) parts.push(`«${project}» төслийн «${task}» ажилд ажиллав.`);
  else if (task) parts.push(`«${task}» ажилд ажиллав.`);
  else parts.push('Revit загвар дээр ажиллав.');

  const sheets = f.sheetLabels.map((s) => s.trim()).filter(Boolean);
  if (sheets.length > 0) {
    const shown = sheets.slice(0, 6).join(', ');
    const rest = sheets.length > 6 ? ` (нийт ${sheets.length} хуудас)` : '';
    parts.push(`Хуудас: ${shown}${rest}.`);
  }

  const groups = (f.groups ?? []).filter((g) => g && g.count > 0);
  if (groups.length > 0) {
    if (typeof f.visibleTotal === 'number' && f.visibleTotal > 0) {
      parts.push(`Загварт ${f.visibleTotal} элемент хөдөлсөн:`);
    }
    for (const g of groups.slice(0, MAX_TEMPLATE_GROUPS)) parts.push(groupSentence(g));

    const rest = (f.moreGroups ?? 0) + Math.max(0, groups.length - MAX_TEMPLATE_GROUPS);
    if (rest > 0) parts.push(`Бусад ${rest} бүлэг.`);
  } else if (typeof f.added === 'number' || typeof f.modified === 'number') {
    // ⚠️ ЗӨВХӨН НӨӨЦ ЗАМ.  Задаргаа ирээгүй (хуучин add-in, эсвэл суурьгүй)
    // үед л түүхий тоог бичнэ — өөр хэлэх юм байхгүй тул.
    const bits: string[] = [];
    if (f.added) bits.push(`${f.added} элемент нэмэгдсэн`);
    if (f.modified) bits.push(`${f.modified} элемент өөрчлөгдсөн`);
    if (bits.length) parts.push(`Загварт ${bits.join(', ')}.`);
  }

  const prev = Math.round(f.previousPercent);
  const now = Math.round(f.percent);
  parts.push(prev === now ? `Явц: ${now}%.` : `Явц: ${prev}% → ${now}%.`);

  // ⚠️ Задаргаа ирээгүй үед ЮУ Ч БИЧИХГҮЙ.  Урьд нь энд `added`/`modified`
  // гэсэн ТҮҮХИЙ тоо бичигддэг байсан — тэр нь яг л хориглосон хэмжүүр тул
  // нөөц зам ч байж БОЛОХГҮЙ.  Хэлэх юм байхгүй бол дуугүй байх нь дээр.

  if (f.basisDetail.trim()) parts.push(`Эх сурвалж: ${f.basisDetail.trim()}.`);

  return clamp(parts.join(' '));
}

function clamp(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_NOTE_LENGTH ? t.slice(0, MAX_NOTE_LENGTH - 1) + '…' : t;
}

/**
 * AI-ийн бичвэрийг ХҮЛЭЭЖ АВАХ эсэх.  Цэвэр функц — тестийн гол цэг.
 *
 * Татгалзах шалтгаанууд:
 *   • хоосон / хэт богино
 *   • бодит хувиас ӨӨР `NN%` тэмдэглэгээ агуулсан  ← хамгийн чухал
 *   • өгөгдөөгүй `N ширхэг` тоо агуулсан            ← 2026-08-26
 *   • кирилл үсэг бараг байхгүй (загвар англиар хариулсан)
 *
 * ⚠️ ЯАГААД «ширхэг»-ийг ТУСГАЙЛАН шалгадаг вэ: тэмдэглэл нь одоо элементийн
 * ТООГ агуулдаг болсон тул AI 9-ийг 19 болгож бичих боломжтой — тайлан дахь
 * тоо загварын бодит байдалтай зөрнө.  Бүх тоог шалгаж БОЛОХГҮЙ: түвшний нэр
 * («1-р давхар»), төрлийн нэр («Хана 200мм») дотор ч тоо байдаг.  Тиймээс
 * ЯГ «N ширхэг» хэлбэрийг л барина — тоо гарах цорын ганц утга учиртай газар.
 */
export function isAcceptableNote(
  text: string,
  percent: number,
  allowedCounts?: readonly number[],
): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (t.length > MAX_NOTE_LENGTH * 2) return false;

  const allowed = new Set([String(Math.round(percent)), String(Math.trunc(percent))]);
  for (const m of t.matchAll(/(\d{1,3})\s*%/g)) {
    if (!allowed.has(m[1]!)) return false;
  }

  if (allowedCounts && allowedCounts.length > 0) {
    const counts = new Set(allowedCounts.map((n) => String(n)));
    for (const m of t.matchAll(/(\d{1,5})\s*ширхэг/g)) {
      if (!counts.has(m[1]!)) return false;
    }
  }

  const cyrillic = (t.match(/[Ѐ-ӿ]/g) ?? []).length;
  if (cyrillic < t.replace(/\s/g, '').length * 0.4) return false;

  return true;
}

export interface NoteResult {
  note: string;
  ai_model: string | null;
  ai_prompt_version: string;
  /** true = AI ажиллаагүй эсвэл шалгалт давсангүй, загвар очив. */
  fallback: boolean;
}

const SYSTEM_PROMPT =
  'Чи бол барилгын зураг төслийн компанийн монгол хэлний туслах. ' +
  'Инженерийн өдрийн ажлын ТАЙЛАНГИЙН бичвэрийг МОНГОЛООР бичнэ. ' +
  'Дүрэм: (1) зөвхөн өгөгдсөн баримтыг ашиглана, шинэ зүйл ЗОХИОХГҮЙ; ' +
  '(2) хувь болон элементийн ТООГ өөрчлөхгүй — өгөгдсөн тоог ЯГ ТЭР ХЭВЭЭР бич; ' +
  '(3) 2-5 өгүүлбэр, албан бөгөөд урсгалтай — жагсаалт биш, ӨГҮҮЛБЭР; ' +
  '(4) аль хуудсанд, аль давхарт, юуг, хэдийг хийснийг ТОДОРХОЙ хэл; ' +
  '(5) зөвхөн тэмдэглэлийг буцаа — оршил, тайлбар, тэмдэглэгээ бичихгүй.';

/**
 * Тэмдэглэл үүсгэнэ.  ХЭЗЭЭ Ч алдаа шидэхгүй — хамгийн муудаа загвар буцаана.
 *
 * `ai` нь null байж болно (тест, эсвэл binding байхгүй орчин) — тэр үед
 * шууд загвар руу шилжинэ.
 */
export async function generateRevitNote(
  ai: Env['AI'] | null | undefined,
  facts: NoteFacts,
): Promise<NoteResult> {
  const fallbackNote = templateNote(facts);
  const base: NoteResult = {
    note: fallbackNote,
    ai_model: null,
    ai_prompt_version: REVIT_NOTE_PROMPT_VERSION,
    fallback: true,
  };
  if (!ai) return base;

  try {
    const result = (await ai.run(REVIT_NOTE_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: promptFrom(facts) },
      ],
      max_tokens: 400,
    } as AiTextGenerationInput)) as AiTextGenerationOutput;

    const raw = (
      typeof result === 'object' && result && 'response' in result
        ? String((result as { response?: unknown }).response ?? '')
        : ''
    ).trim();

    if (!isAcceptableNote(raw, facts.percent, allowedCountsOf(facts))) return base;

    return {
      note: clamp(raw),
      ai_model: REVIT_NOTE_MODEL,
      ai_prompt_version: REVIT_NOTE_PROMPT_VERSION,
      fallback: false,
    };
  } catch (err) {
    console.error('[revitNoteAi] AI.run failed, falling back to template:', err);
    return base;
  }
}

/** AI-д өгөх БАРИМТУУД — тоо нь аль хэдийн шийдэгдсэн, зөвхөн үг хэрэгтэй. */
function promptFrom(f: NoteFacts): string {
  const lines = [
    `Төсөл: ${f.projectName || '—'}`,
    `Ажил: ${f.taskName || '—'}`,
    `Хуудас: ${f.sheetLabels.length ? f.sheetLabels.join(', ') : '—'}`,
    `Өмнөх явц: ${Math.round(f.previousPercent)}%`,
    `Одоогийн явц: ${Math.round(f.percent)}%`,
  ];
  if (f.basisDetail) lines.push(`Хувийн эх сурвалж: ${f.basisDetail}`);

  const groups = (f.groups ?? []).filter((g) => g && g.count > 0);
  if (groups.length > 0) {
    if (typeof f.visibleTotal === 'number') {
      lines.push(`Нийт хөдөлсөн элемент: ${f.visibleTotal}`);
    }
    lines.push('Хийсэн ажил (мөр бүр: хуудас · давхар · төрөл — үйлдэл):');
    for (const g of groups.slice(0, MAX_TEMPLATE_GROUPS)) lines.push(`  ${groupSentence(g)}`);
    if ((f.moreGroups ?? 0) > 0) lines.push(`  Бусад ${f.moreGroups} бүлэг.`);
  } else {
    // ⚠️ Задаргаагүй үед л түүхий тоог AI-д өгнө.
    if (f.added) lines.push(`Нэмэгдсэн элемент: ${f.added}`);
    if (f.modified) lines.push(`Өөрчлөгдсөн элемент: ${f.modified}`);
  }

  lines.push('');
  lines.push(
    `Дээрх баримтаар 2-5 өгүүлбэртэй монгол тайлангийн бичвэр бич. ` +
      `Хувийг зөвхөн ${Math.round(f.percent)}% гэж бич. ` +
      `Элементийн тоог өгөгдсөн ЯГ ТЭР тоогоор бич, нийлбэр гаргаж БОЛОХГҮЙ.`,
  );
  return lines.join('\n');
}
