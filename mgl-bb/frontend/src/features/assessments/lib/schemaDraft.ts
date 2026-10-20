/**
 * Асуулгын «ноорог» (draft) загвар + Word-оос ирсэн догол мөрийг ангилах эвристик.
 *
 * Яагаад тусдаа загвар вэ: `AssessmentSchema`-гийн id-ууд нь тогтвортой байх
 * ёстой (хариулт `answers_json` дотор item id-аар холбогддог) тул засварлаж
 * байх үед id үүсгэх нь эрсдэлтэй.  Ноорог дээр бүх зүйл түр `key`-тэй бөгөөд
 * эцсийн id-г ЗӨВХӨН `draftToSchema` хадгалахын өмнө нэг удаа тогтооно
 * (`s1.1` / `g1.1.1` / `g1.1.1-1` — seed JSON-той ижил конвенц).
 *
 * Автомат таних хэзээ ч 100% байхгүй тул энд бүх зүйл «санал» —
 * `TemplateBuilder` дээр админ гараар засна (docs/dev/assessments-spec.md §8).
 */

import type {
  AssessmentGroup,
  AssessmentItem,
  AssessmentLevelBand,
  AssessmentPart,
  AssessmentScale,
  AssessmentSchema,
  AssessmentSection,
} from '../types';
import type { DocxParagraph } from './docxParse';
import { DEFAULT_LEVELS } from './score';

// ---------------------------------------------------------------------------
// Ноорогийн төрлүүд
// ---------------------------------------------------------------------------

export interface DraftItem {
  key: string;
  text: string;
  reverse?: boolean;
}

export interface DraftGroup {
  key: string;
  title: string;
  hint?: string;
  items: DraftItem[];
}

export interface DraftSection {
  key: string;
  code: string;
  title: string;
  subtitle?: string;
  description?: string;
  /** Жин 0 байж болно — хадгалахад шар сэрэмжлүүлэг гарна, хориглохгүй. */
  weight: number;
  groups: DraftGroup[];
}

export interface DraftPart {
  key: string;
  /** Хадгалагдсан схемээс ирсэн анхны `id` — байвал хэвээр үлдээнэ. */
  id?: string;
  title: string;
  intro?: string;
  scaleId: string;
  chart: 'scatter' | 'radar';
  weighted: boolean;
  paging: 'section' | 'part';
  sections: DraftSection[];
}

/** Танилцуулга хуудасны нэг блок (асуулт БИШ — зөвхөн уншина). */
export interface DraftIntroBlock {
  key: string;
  heading: string;
  body: string;
}

export interface SchemaDraft {
  /** Template-ийн мета — хадгалахад `TemplateInput` руу шууд орно. */
  code: string;
  titleMn: string;
  titleEn: string;
  description: string;
  /** Анхдагч баг ('BB') — раунд үүсгэх алхамд урьдчилан бөглөгдөнө. */
  teamCodes: string[];
  /** Анхдагч үнэлэгчид (senior user id) — мөн адил урьдчилан бөглөгдөнө. */
  seniorUserIds: number[];
  scales: AssessmentScale[];
  levels: AssessmentLevelBand[];
  /** Ажилтан бөглөж эхлэхийн ӨМНӨ уншдаг заавар — wizard-ын 1-р хуудас. */
  intro: DraftIntroBlock[];
  parts: DraftPart[];
  /** Ангилагдаагүй догол мөрүүд — админ гараар оноож эсвэл хаяж болно. */
  unclassified: string[];
}

export type DraftNodeKind = 'part' | 'section' | 'group' | 'item';

export interface DraftNodeRef {
  kind: DraftNodeKind;
  key: string;
}

/** Хадгалахын өмнөх шалгалтын үр дүн. i18n түлхүүр + параметр (текст биш). */
export interface DraftWarning {
  key: string;
  params?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Анхдагч шатлалууд (архитекторын судалгаа — backend/scripts/assessments/architect-v1.json)
// ---------------------------------------------------------------------------

export const DEFAULT_SCALES: AssessmentScale[] = [
  {
    id: 'experience',
    label: 'Туршлагын оноо',
    min: 1,
    max: 5,
    options: [
      {
        value: 5,
        label: 'EXPERT',
        caption:
          '20 ба түүнээс дээш төсөлд тухайн ажлыг хийж гүйцэтгэсэн. Тухайн гүйцэтгэлд зөвлөх чадамжтай тохиолдолд',
      },
      {
        value: 4,
        label: 'SENIOR',
        caption:
          '10-19 хүртлэх төсөлд тухайн ажлыг хийж гүйцэтгэсэн. Тухайн гүйцэтгэлд ахлах чадамжтай тохиолдолд',
      },
      {
        value: 3,
        label: 'MIDDLE',
        caption:
          '5-9 хүртлэх төсөлд тухайн ажлыг давтан хийж гүйцэтгэсэн. Тухайн гүйцэтгэлд бие даан, болон хамтран гүйцэтгэх чадамжтай тохиолдолд',
      },
      {
        value: 2,
        label: 'JUNIOR',
        caption:
          '2-4 удаа тухайн ажлыг давтан хийж гүйцэтгэсэн, өгсөн үүрэг даалгаварын дагуу хийх бие даан суралцах чадамжтай тохиолдолд',
      },
      {
        value: 1,
        label: 'INTERN',
        caption:
          'Тухайн ажлыг 1 ба түүнээс дээш хийж гүйцэтгэж байгаагүй, онолын мэдлэгтэй, өгсөн үүргийн дагуу суралцан хийх чадамжтай тохиолдолд',
      },
    ],
  },
  {
    id: 'behavior',
    label: 'Зан чанарын давтамж',
    min: 1,
    max: 5,
    options: [
      {
        value: 1,
        label: 'Үгүй',
        caption: 'Ийм зан байдал надад огт байдаггүй. Харин ч эсэргээрээ байдаг.',
      },
      {
        value: 2,
        label: 'Хааяа, тогтворгүй',
        caption: 'Хааяа илэрдэг ч тогтвортой байнгийн илэрдэг зан чанар биш.',
      },
      { value: 3, label: 'Ихэвчлэн', caption: 'Энгийн нөхцөл байдалд ихэвчлэн илэрдэг зан чанар.' },
      { value: 4, label: 'Тогтмол, байнгын', caption: 'Ачаалалтай байсан ч тогтмол илэрдэг зан чанар.' },
      {
        value: 5,
        label: 'Үргэлж илэрдэг, үлгэр жишээ болохуйц',
        caption: 'Ямар ч нөхцөлд үргэлж илэрдэг бөгөөд хамт олны дунд үлгэр жишээ болохуйц байдаг.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Түр key үүсгэгч — ЗӨВХӨН ноорог доторх таних тэмдэг, DB рүү хэзээ ч очихгүй.
// ---------------------------------------------------------------------------

let keySeq = 0;
function uid(prefix: string): string {
  keySeq += 1;
  return `${prefix}_${keySeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newItem(text = ''): DraftItem {
  return { key: uid('i'), text };
}

export function newIntroBlock(heading = '', body = ''): DraftIntroBlock {
  return { key: uid('n'), heading, body };
}

export function newGroup(title = '', items: DraftItem[] = []): DraftGroup {
  return { key: uid('g'), title, items };
}

export function newSection(title = '', groups: DraftGroup[] = []): DraftSection {
  return { key: uid('s'), code: codeFromTitle(title), title, weight: 0, groups };
}

export function newPart(title = '', overrides: Partial<DraftPart> = {}): DraftPart {
  return {
    key: uid('p'),
    title,
    scaleId: DEFAULT_SCALES[0]?.id ?? 'experience',
    chart: 'scatter',
    weighted: true,
    paging: 'section',
    sections: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Эвристик ангилагч (docs/dev/assessments-spec.md §8)
// ---------------------------------------------------------------------------

/** `1.1.1 Текст` — дэд асуулт (group). */
const GROUP_RE = /^(\d+)\.(\d+)\.(\d+)\.?\s+(.+)$/;
/** `1.1 НЭР` — хэсэг (section). */
const SECTION_RE = /^(\d+)\.(\d+)\.?\s+(.+)$/;
/** `1. Текст` — контекстээс хамаараад section эсвэл item. */
const NUMBERED_RE = /^(\d+)[.)]\s+(.+)$/;
/** Бүтнээрээ хаалтанд — өмнөх зүйлийн тайлбар. */
const PAREN_RE = /^[([](.+)[)\]]$/;

/** Латин/кирилл үсгийг ялгаж, богино ТОМ ҮСГЭЭР бичсэн мөрийг гарчиг гэж үзнэ. */
function isShoutedHeading(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  if (letters !== letters.toLocaleUpperCase()) return false;
  return text.length <= 60 && text.split(/\s+/).length <= 8;
}

function isHeadingStyle(style: string | undefined): boolean {
  if (!style) return false;
  return /^(heading|title|Гарчиг)/i.test(style);
}

/** Жагсаалтын элемент — `w:numPr` эсвэл «ListParagraph» загвар. */
function isListParagraph(p: DocxParagraph): boolean {
  return Boolean(p.numId) || /listparagraph|листпараграф/i.test(p.style ?? '');
}

/** «Concept Design» → «CONCEPT_DESIGN». Хоосон бол `SECTION`. */
export function codeFromTitle(title: string): string {
  const base = title
    .replace(/^\d+(\.\d+)*\.?\s*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLocaleUpperCase();
  return base.slice(0, 40) || 'SECTION';
}

function appendText(existing: string | undefined, add: string): string {
  return existing && existing.trim() ? `${existing}\n${add}` : add;
}

/** Зан чанарын хэсгийг таних түлхүүр үг (part автомат салгалтад). */
const BEHAVIOR_RE = /зан\s*чанар/i;

/**
 * «Word дээр 2 судалгаа байсан бололтой» гэсэн САНАЛ.
 *
 * Хэрэглэгч импортын дараа зөвшөөрвөл `applyPartSplit`-ээр хэрэгжинэ —
 * автоматаар хэзээ ч хэрэгжихгүй (буруу таасан part-ыг буцаах нь section
 * дэвшүүлэхээс хэцүү, spec §8-ийн «заавал нүдээр шалга» зарчим).
 */
export interface PartSplitProposal {
  parts: {
    title: string;
    /**
     * `draft.parts[0].sections` дэх ЭХЛЭХ индекс + хамрах тоо.
     *
     * ⚠️ Түр `key` БИШ индексээр илэрхийлэв: санал нь сервер рүү нэг эргэж
     * (draft template болж хадгалагдаад буцаж уншигдана) ирдэг бөгөөд тэр
     * үед бүх key шинээр үүсдэг — key-д тулгуурласан санал тэнд тасарна.
     * Дараалал нь харин хадгалалтаар өөрчлөгддөггүй.
     */
    from: number;
    sectionCount: number;
    itemCount: number;
    /** Гарчигт нь «зан чанар» орсон эсэх — radar / жингүй горим санал болгоно. */
    behavior: boolean;
  }[];
}

export interface DraftImportResult {
  draft: SchemaDraft;
  /** ≥2 судалгаа сэжиглэвэл л утгатай; эс бөгөөс `null`. */
  split: PartSplitProposal | null;
}

/**
 * Догол мөрүүдийг ноорог болгоно.
 *
 * ⚠️ Бүх зүйл НЭГ part дотор орно.  Word дээр `1.x` ба `2.x` гэж хоёр судалгаа
 * байлаа ч энд ШУУД салгахгүй — оронд нь `split` САНАЛ буцааж, админаас
 * асууна («PART гэж таамаглахаас илүү SECTION»).
 *
 * Оноо өгөх мөргүй (0 мөртэй) хэсгүүдийг ХОЁР янзаар ялгана:
 *   • асуулттай хэсгийн ЯГ ӨМНӨ зогсож буй нь → тухайн part-ын ГАРЧИГ
 *     («ТУРШЛАГА ДЭЭР ҮНДЭСЛЭСЭН УР ЧАДВАРЫН АСУУЛГА», «ЗАН ЧАНАРЫН АСУУЛГА»),
 *   • бусад нь → ТАНИЛЦУУЛГА блок (ажилтан бөглөхийн өмнө уншина).
 * Ингэснээр «0 мөртэй хог хэсэг» гэж харагддаг байсан зүйлс утга оллоо.
 */
export function paragraphsToDraft(paras: DocxParagraph[]): DraftImportResult {
  const part = newPart('Асуулга');
  const draft: SchemaDraft = {
    code: '',
    titleMn: '',
    titleEn: '',
    description: '',
    teamCodes: [],
    seniorUserIds: [],
    scales: DEFAULT_SCALES.map((s) => ({ ...s, options: s.options.map((o) => ({ ...o })) })),
    levels: DEFAULT_LEVELS.map((l) => ({ ...l })),
    intro: [],
    parts: [part],
    unclassified: [],
  };

  // ⚠️ Курсорыг ОБЪЕКТ дотор барина.  TypeScript-ийн урсгалын шинжилгээ нь
  // дотоод функцээс `let` хувьсагчид олгосон утгыг тоолдоггүй тул энгийн
  // `let section: DraftSection | null = null` бол доор `never` болж хумигдана.
  const cur: { section: DraftSection | null; group: DraftGroup | null } = {
    section: null,
    group: null,
  };

  const startSection = (title: string): DraftSection => {
    const created = newSection(title);
    part.sections.push(created);
    cur.section = created;
    cur.group = null;
    return created;
  };

  const ensureSection = (): DraftSection =>
    cur.section ?? startSection(`Хэсэг ${part.sections.length + 1}`);

  const ensureGroup = (): DraftGroup => {
    if (cur.group) return cur.group;
    const parent = ensureSection();
    const created = newGroup(parent.title);
    parent.groups.push(created);
    cur.group = created;
    return created;
  };

  let seen = 0;

  for (const p of paras) {
    const text = p.text.trim();
    if (!text) continue;
    seen += 1;

    // 0) Баримтын хамгийн эхний гарчиг = асуулгын нэр (хоосон хэсэг үүсгэхгүй).
    if (
      seen === 1 &&
      !GROUP_RE.test(text) &&
      !SECTION_RE.test(text) &&
      !NUMBERED_RE.test(text) &&
      (isHeadingStyle(p.style) || isShoutedHeading(text))
    ) {
      draft.titleMn = text;
      part.title = text;
      continue;
    }

    // 1) Бүтнээрээ хаалтанд → өмнөх group/section-ийн тайлбар.
    const paren = PAREN_RE.exec(text);
    if (paren && (cur.group || cur.section)) {
      const inner = (paren[1] ?? '').trim();
      if (cur.group) cur.group.hint = appendText(cur.group.hint, inner);
      else if (cur.section) cur.section.description = appendText(cur.section.description, inner);
      continue;
    }

    // 2) `1.1.1 …` → дэд асуулт.
    if (GROUP_RE.test(text)) {
      const parent = ensureSection();
      // Seed JSON-д дугаарлалт нь гарчигтайгаа хамт үлддэг тул бүтнээр нь авна.
      const created = newGroup(text);
      parent.groups.push(created);
      cur.group = created;
      continue;
    }

    // 3) `1.1 НЭР` → хэсэг.
    const sec = SECTION_RE.exec(text);
    if (sec) {
      startSection((sec[3] ?? '').trim());
      continue;
    }

    // 4) `1. …` → ТОМ ҮСГЭЭР бол хэсэг, эсрэг тохиолдолд оноо өгөх мөр.
    const num = NUMBERED_RE.exec(text);
    if (num) {
      const rest = (num[2] ?? '').trim();
      if (isHeadingStyle(p.style) || isShoutedHeading(rest)) {
        startSection(rest);
      } else {
        ensureGroup().items.push(newItem(rest));
      }
      continue;
    }

    // 5) Жагсаалтын элемент → оноо өгөх мөр.
    if (isListParagraph(p)) {
      ensureGroup().items.push(newItem(text));
      continue;
    }

    // 6) Heading загвар эсвэл ТОМ ҮСГЭЭР богино мөр → хэсэг гэж таамаглана.
    //    Хүснэгтийн нүд энд ОРОХГҮЙ: онооны тайлбар хүснэгтийн «5 — EXPERT»
    //    мэт нүднүүд бүгд ТОМ ҮСГЭЭР бичигдсэн байдаг тул хуурамч хэсэг үүсгэнэ.
    if (!p.inTable && (isHeadingStyle(p.style) || isShoutedHeading(text))) {
      startSection(text);
      continue;
    }

    // 7) Үлдсэн нь: гарчгийн үргэлжлэл бол тайлбарт наана, үгүй бол ангилалгүй.
    if (cur.group && cur.group.items.length === 0) {
      cur.group.hint = appendText(cur.group.hint, text);
    } else if (cur.section && !cur.group) {
      cur.section.description = appendText(cur.section.description, text);
    } else {
      draft.unclassified.push(text);
    }
  }

  /* ---- Оноо өгөх мөргүй хэсгүүдийг задлах ---- */
  const kept: DraftSection[] = [];
  /** Асуулттай хэсэг эхлэхийг хүлээж буй хамгийн сүүлийн хоосон гарчиг. */
  let pendingHeading: string | null = null;
  /** Part-ын зааг бүр: гарчиг + тэндээс эхлэх хэсгийн индекс (`kept` дотор). */
  const boundaries: { title: string; at: number }[] = [];

  for (const section of part.sections) {
    if (sectionItemCount(section) > 0) {
      if (pendingHeading) {
        boundaries.push({ title: pendingHeading, at: kept.length });
        pendingHeading = null;
      }
      kept.push(section);
      continue;
    }
    // 0 мөртэй: өмнөх «хүлээгдэж буй» гарчиг нь эцсийн эцэст асуулттай хэсэг
    // дагаагүй тул танилцуулга болно, энэ нь шинэ нэр дэвшигч болно.
    if (pendingHeading) {
      draft.intro.push(newIntroBlock(pendingHeading, ''));
    }
    pendingHeading = section.title.trim() || null;
    const body = (section.description ?? '').trim();
    if (body) {
      // Тайлбартай хоосон хэсэг бол гарчиг+бие нь бүхэлдээ танилцуулга.
      draft.intro.push(newIntroBlock(pendingHeading ?? '', body));
      pendingHeading = null;
    }
  }
  // Хамгийн сүүлд үлдсэн гарчиг ямар ч асуулт дагуулаагүй → танилцуулга.
  if (pendingHeading) draft.intro.push(newIntroBlock(pendingHeading, ''));

  part.sections = kept;

  // Эхний зааг нь энэ part-ын нэр болно (нэг л part байгаа тул).
  const firstBoundary = boundaries[0];
  if (firstBoundary && firstBoundary.at === 0) {
    part.title = firstBoundary.title;
    if (!draft.titleMn.trim()) draft.titleMn = firstBoundary.title;
  }

  // Гарчиггүй хэсгүүдийн кодыг эцэст нь дахин тогтооно (гарчиг сүүлд өөрчлөгдсөн байж болно).
  for (const s of part.sections) if (!s.code) s.code = codeFromTitle(s.title);

  return { draft, split: proposalFromBoundaries(part.sections, boundaries) };
}

/** Заагуудаас ≥2 part-ын санал бүтээнэ (1 л зааг байвал `null`). */
function proposalFromBoundaries(
  sections: DraftSection[],
  boundaries: { title: string; at: number }[],
): PartSplitProposal | null {
  // Эхний зааг 0-оос эхлээгүй бол урд талд нэргүй бүлэг үлдэнэ — түүнийг ч
  // нэг part болгож тооцно, эс бөгөөс тэр хэсгүүд хаяа алдагдана.
  const marks = [...boundaries];
  if (!marks.length || (marks[0]?.at ?? 0) > 0) marks.unshift({ title: '', at: 0 });
  if (marks.length < 2) return null;

  const parts = marks.map((mark, i) => {
    const end = marks[i + 1]?.at ?? sections.length;
    const slice = sections.slice(mark.at, end);
    return {
      title: mark.title,
      from: mark.at,
      sectionCount: slice.length,
      itemCount: slice.reduce((sum, s) => sum + sectionItemCount(s), 0),
      behavior: BEHAVIOR_RE.test(mark.title),
    };
  });

  // Асуулттай хэсэггүй «part» нь салгалтад утгагүй.
  return parts.filter((p) => p.itemCount > 0).length >= 2 ? { parts } : null;
}

/**
 * Саналыг хэрэгжүүлж НЭГ part-ыг олон part болгоно.
 *
 * Зан чанарын part нь `behavior` шатлал + radar + жингүй + нэг хуудас
 * (spec §2) — эдгээр нь домэйны тогтсон анхдагч утга, админ дараа нь өөрчилж
 * болно.  Ур чадварын part нь одоогийн тохиргоогоо хэвээр авна.
 */
export function applyPartSplit(draft: SchemaDraft, proposal: PartSplitProposal): SchemaDraft {
  const next = cloneDraft(draft);
  const source = next.parts[0];
  if (!source) return draft;

  const created: DraftPart[] = [];

  proposal.parts.forEach((spec, i) => {
    const sections = source.sections.slice(spec.from, spec.from + spec.sectionCount);
    if (!sections.length) return;
    const behaviorScale = next.scales.find((s) => s.id === 'behavior');
    created.push(
      newPart(spec.title || source.title || `Асуулга ${i + 1}`, {
        // Эхний part нь эх part-ын id-г ӨВЛӨНӨ — хадгалагдсан template-ийг
        // засварлаж байгаа бол part id тогтвортой үлдэнэ.
        ...(i === 0 && source.id ? { id: source.id } : {}),
        scaleId: spec.behavior && behaviorScale ? behaviorScale.id : source.scaleId,
        chart: spec.behavior ? 'radar' : source.chart,
        weighted: spec.behavior ? false : source.weighted,
        paging: spec.behavior ? 'part' : source.paging,
        sections,
      }),
    );
  });

  if (!created.length) return draft;
  next.parts = [...created, ...next.parts.slice(1)];
  return next;
}

/** Word-гүйгээр гараар эхлэх — нэг part / нэг section / нэг group / нэг мөр. */
export function emptyDraft(): SchemaDraft {
  const group = newGroup('');
  group.items.push(newItem(''));
  const section = newSection('');
  section.groups.push(group);
  const part = newPart('Асуулга');
  part.sections.push(section);
  return {
    code: '',
    titleMn: '',
    titleEn: '',
    description: '',
    teamCodes: [],
    seniorUserIds: [],
    scales: DEFAULT_SCALES.map((s) => ({ ...s, options: s.options.map((o) => ({ ...o })) })),
    levels: DEFAULT_LEVELS.map((l) => ({ ...l })),
    intro: [],
    parts: [part],
    unclassified: [],
  };
}

// ---------------------------------------------------------------------------
// Ноорог ↔ схем
// ---------------------------------------------------------------------------

export interface DraftStats {
  parts: number;
  sections: number;
  groups: number;
  items: number;
  unclassified: number;
  /** Танилцуулга блокийн тоо (0 бол тэр хуудас гарахгүй). */
  intro: number;
}

export function draftStats(draft: SchemaDraft): DraftStats {
  let sections = 0;
  let groups = 0;
  let items = 0;
  for (const part of draft.parts) {
    sections += part.sections.length;
    for (const section of part.sections) {
      groups += section.groups.length;
      for (const group of section.groups) items += group.items.length;
    }
  }
  return {
    parts: draft.parts.length,
    sections,
    groups,
    items,
    unclassified: draft.unclassified.length,
    intro: draft.intro.length,
  };
}

/** Нэг хэсгийн оноо өгөх мөрийн тоо (must = мөр × scale.max). */
export function sectionItemCount(section: DraftSection): number {
  return section.groups.reduce((sum, g) => sum + g.items.length, 0);
}

export function partItemCount(part: DraftPart): number {
  return part.sections.reduce((sum, s) => sum + sectionItemCount(s), 0);
}

/** Part-ын шатлалыг олох (олдохгүй бол эхний шатлал, түүнийг ч байхгүй бол 1..5). */
export function scaleOf(draft: SchemaDraft, part: DraftPart): AssessmentScale {
  return (
    draft.scales.find((s) => s.id === part.scaleId) ??
    draft.scales[0] ?? { id: 'default', label: '', min: 1, max: 5, options: [] }
  );
}

/**
 * Эцсийн id-уудыг тогтоож схем болгоно + сэрэмжлүүлэг цуглуулна.
 *
 * Конвенц (seed JSON-той ижил):  section `s1.1` · group `g1.1.1` · item `g1.1.1-1`.
 */
export function draftToSchema(draft: SchemaDraft): {
  schema: AssessmentSchema;
  warnings: DraftWarning[];
} {
  const warnings: DraftWarning[] = [];
  const seenCodes = new Map<string, number>();
  const parts: AssessmentPart[] = [];

  draft.parts.forEach((part, pi) => {
    const p = pi + 1;
    const partTitle = part.title.trim() || `Хэсэг ${p}`;

    if (!draft.scales.some((s) => s.id === part.scaleId)) {
      warnings.push({ key: 'assessments.builder.warnScaleMissing', params: { part: partTitle } });
    }
    if (part.sections.length === 0) {
      warnings.push({ key: 'assessments.builder.warnNoSections', params: { part: partTitle } });
    }

    const sections: AssessmentSection[] = part.sections.map((section, si) => {
      const sectionId = `s${p}.${si + 1}`;
      const title = section.title.trim() || `Хэсэг ${p}.${si + 1}`;

      let code = (section.code || '').trim().toLocaleUpperCase() || codeFromTitle(title);
      const dup = seenCodes.get(code);
      if (dup === undefined) {
        seenCodes.set(code, 1);
      } else {
        seenCodes.set(code, dup + 1);
        warnings.push({ key: 'assessments.builder.warnDupCode', params: { code } });
        code = `${code}_${dup + 1}`;
      }

      const groups: AssessmentGroup[] = section.groups.map((group, gi) => {
        const groupId = `g${p}.${si + 1}.${gi + 1}`;
        const items: AssessmentItem[] = group.items
          .filter((item) => item.text.trim().length > 0)
          .map((item, ii) => ({
            id: `${groupId}-${ii + 1}`,
            text: item.text.trim(),
            ...(item.reverse ? { reverse: true as const } : {}),
          }));

        if (items.length === 0) {
          warnings.push({
            key: 'assessments.builder.warnEmptyGroup',
            params: { section: title, group: group.title.trim() || groupId },
          });
        }

        return {
          id: groupId,
          title: group.title.trim() || title,
          ...(group.hint && group.hint.trim() ? { hint: group.hint.trim() } : {}),
          items,
        };
      });

      const itemCount = groups.reduce((sum, g) => sum + g.items.length, 0);
      if (itemCount === 0) {
        warnings.push({ key: 'assessments.builder.warnEmptySection', params: { section: title } });
      }

      return {
        id: sectionId,
        code,
        title,
        ...(section.subtitle && section.subtitle.trim() ? { subtitle: section.subtitle.trim() } : {}),
        ...(section.description && section.description.trim()
          ? { description: section.description.trim() }
          : {}),
        weight: Number.isFinite(section.weight) ? section.weight : 0,
        groups,
      };
    });

    if (part.weighted && sections.length > 0) {
      const sum = sections.reduce((acc, s) => acc + (s.weight || 0), 0);
      if (Math.abs(sum - 100) > 0.001) {
        warnings.push({
          key: 'assessments.builder.warnWeightSum',
          params: { part: partTitle, sum: Math.round(sum * 100) / 100 },
        });
      }
    }

    parts.push({
      id: part.id?.trim() || `part${p}`,
      title: partTitle,
      ...(part.intro && part.intro.trim() ? { intro: part.intro.trim() } : {}),
      scaleId: part.scaleId,
      chart: part.chart,
      weighted: part.weighted,
      paging: part.paging,
      sections,
    });
  });

  if (draft.unclassified.length > 0) {
    warnings.push({
      key: 'assessments.builder.warnUnclassified',
      params: { count: draft.unclassified.length },
    });
  }

  // Танилцуулга блокуудын id нь ноорогийн түр key-ээс ХАМААРАХГҮЙ, дараалалдаа
  // тулгуурлана (`n1`, `n2`…) — item id-тэй ижил зарчим.  Хоосон блок хаягдана.
  const intro = draft.intro
    .map((block) => ({ heading: block.heading.trim(), body: block.body.trim() }))
    .filter((block) => block.heading || block.body)
    .map((block, i) => ({
      id: `n${i + 1}`,
      ...(block.heading ? { heading: block.heading } : {}),
      ...(block.body ? { body: block.body } : {}),
    }));

  const schema: AssessmentSchema = {
    version: 1,
    scales: draft.scales,
    levels: draft.levels.length ? draft.levels : DEFAULT_LEVELS,
    parts,
    ...(intro.length ? { intro } : {}),
  };

  if (draftStats(draft).items === 0) {
    warnings.push({ key: 'assessments.builder.warnNoItems' });
  }

  return { schema, warnings };
}

/** Хадгалагдсан схемийг буцааж ноорог болгоно (одоо байгаа template засварлах). */
export function schemaToDraft(
  schema: AssessmentSchema,
  meta?: {
    code?: string;
    titleMn?: string;
    titleEn?: string | null;
    description?: string | null;
    teamCodes?: string[];
    seniorUserIds?: number[];
  },
): SchemaDraft {
  return {
    code: meta?.code ?? '',
    titleMn: meta?.titleMn ?? '',
    titleEn: meta?.titleEn ?? '',
    description: meta?.description ?? '',
    teamCodes: [...(meta?.teamCodes ?? [])],
    seniorUserIds: [...(meta?.seniorUserIds ?? [])],
    scales: (schema.scales ?? []).map((s) => ({ ...s, options: s.options.map((o) => ({ ...o })) })),
    levels: (schema.levels?.length ? schema.levels : DEFAULT_LEVELS).map((l) => ({ ...l })),
    intro: (schema.intro ?? []).map((block) =>
      newIntroBlock(block.heading ?? '', block.body ?? ''),
    ),
    parts: (schema.parts ?? []).map((part) => ({
      key: uid('p'),
      id: part.id,
      title: part.title,
      ...(part.intro ? { intro: part.intro } : {}),
      scaleId: part.scaleId,
      chart: part.chart,
      weighted: part.weighted,
      paging: part.paging,
      sections: part.sections.map((section) => ({
        key: uid('s'),
        code: section.code,
        title: section.title,
        ...(section.subtitle ? { subtitle: section.subtitle } : {}),
        ...(section.description ? { description: section.description } : {}),
        weight: section.weight,
        groups: section.groups.map((group) => ({
          key: uid('g'),
          title: group.title,
          ...(group.hint ? { hint: group.hint } : {}),
          items: group.items.map((item) => ({
            key: uid('i'),
            text: item.text,
            ...(item.reverse ? { reverse: true } : {}),
          })),
        })),
      })),
    })),
    unclassified: [],
  };
}

// ---------------------------------------------------------------------------
// Засварлах туслахууд — бүгд ШИНЭ ноорог буцаана (React state-д шууд тавина).
// Ноорог жижиг (≤ ~300 мөр) тул хуулж мутациалах нь хамгийн уншигдахуйц.
// ---------------------------------------------------------------------------

function cloneItem(item: DraftItem): DraftItem {
  return { ...item };
}
function cloneGroup(group: DraftGroup): DraftGroup {
  return { ...group, items: group.items.map(cloneItem) };
}
function cloneSection(section: DraftSection): DraftSection {
  return { ...section, groups: section.groups.map(cloneGroup) };
}
function clonePart(part: DraftPart): DraftPart {
  return { ...part, sections: part.sections.map(cloneSection) };
}
export function cloneDraft(draft: SchemaDraft): SchemaDraft {
  return {
    ...draft,
    teamCodes: [...draft.teamCodes],
    seniorUserIds: [...draft.seniorUserIds],
    scales: draft.scales.map((s) => ({ ...s, options: s.options.map((o) => ({ ...o })) })),
    levels: draft.levels.map((l) => ({ ...l })),
    intro: draft.intro.map((b) => ({ ...b })),
    parts: draft.parts.map(clonePart),
    unclassified: [...draft.unclassified],
  };
}

// --- танилцуулга блокууд ---------------------------------------------------

export function addIntroBlock(draft: SchemaDraft, afterKey?: string): SchemaDraft {
  const next = cloneDraft(draft);
  const created = newIntroBlock('', '');
  const at = afterKey ? next.intro.findIndex((b) => b.key === afterKey) : -1;
  if (at >= 0) next.intro.splice(at + 1, 0, created);
  else next.intro.push(created);
  return next;
}

export function updateIntroBlock(
  draft: SchemaDraft,
  key: string,
  patch: Partial<Omit<DraftIntroBlock, 'key'>>,
): SchemaDraft {
  const next = cloneDraft(draft);
  const block = next.intro.find((b) => b.key === key);
  if (block) Object.assign(block, patch);
  return next;
}

export function removeIntroBlock(draft: SchemaDraft, key: string): SchemaDraft {
  const next = cloneDraft(draft);
  next.intro = next.intro.filter((b) => b.key !== key);
  return next;
}

export function moveIntroBlock(draft: SchemaDraft, key: string, delta: -1 | 1): SchemaDraft {
  const next = cloneDraft(draft);
  const index = next.intro.findIndex((b) => b.key === key);
  return moveWithin(next.intro, index, delta) ? next : draft;
}

export function updateTeamCodes(draft: SchemaDraft, teamCodes: string[]): SchemaDraft {
  return { ...cloneDraft(draft), teamCodes: [...new Set(teamCodes)] };
}

export function updateSeniorUserIds(draft: SchemaDraft, seniorUserIds: number[]): SchemaDraft {
  return { ...cloneDraft(draft), seniorUserIds: [...new Set(seniorUserIds)] };
}

interface Located {
  part: DraftPart;
  partIndex: number;
  section: DraftSection | null;
  sectionIndex: number;
  group: DraftGroup | null;
  groupIndex: number;
  item: DraftItem | null;
  itemIndex: number;
}

/** Түлхүүрээр ноорогийн модноос зангилааг олно (эцэг эхийг нь бас буцаана). */
export function locate(draft: SchemaDraft, ref: DraftNodeRef): Located | null {
  for (let pi = 0; pi < draft.parts.length; pi += 1) {
    const part = draft.parts[pi];
    if (!part) continue;
    if (ref.kind === 'part' && part.key === ref.key) {
      return {
        part,
        partIndex: pi,
        section: null,
        sectionIndex: -1,
        group: null,
        groupIndex: -1,
        item: null,
        itemIndex: -1,
      };
    }
    for (let si = 0; si < part.sections.length; si += 1) {
      const section = part.sections[si];
      if (!section) continue;
      if (ref.kind === 'section' && section.key === ref.key) {
        return {
          part,
          partIndex: pi,
          section,
          sectionIndex: si,
          group: null,
          groupIndex: -1,
          item: null,
          itemIndex: -1,
        };
      }
      for (let gi = 0; gi < section.groups.length; gi += 1) {
        const group = section.groups[gi];
        if (!group) continue;
        if (ref.kind === 'group' && group.key === ref.key) {
          return {
            part,
            partIndex: pi,
            section,
            sectionIndex: si,
            group,
            groupIndex: gi,
            item: null,
            itemIndex: -1,
          };
        }
        for (let ii = 0; ii < group.items.length; ii += 1) {
          const item = group.items[ii];
          if (!item) continue;
          if (ref.kind === 'item' && item.key === ref.key) {
            return {
              part,
              partIndex: pi,
              section,
              sectionIndex: si,
              group,
              groupIndex: gi,
              item,
              itemIndex: ii,
            };
          }
        }
      }
    }
  }
  return null;
}

type Patch<T> = Partial<Omit<T, 'key'>>;

export function updatePart(draft: SchemaDraft, key: string, patch: Patch<DraftPart>): SchemaDraft {
  const next = cloneDraft(draft);
  const found = locate(next, { kind: 'part', key });
  if (found) Object.assign(found.part, patch);
  return next;
}

export function updateSection(
  draft: SchemaDraft,
  key: string,
  patch: Patch<DraftSection>,
): SchemaDraft {
  const next = cloneDraft(draft);
  const found = locate(next, { kind: 'section', key });
  if (found?.section) Object.assign(found.section, patch);
  return next;
}

export function updateGroup(draft: SchemaDraft, key: string, patch: Patch<DraftGroup>): SchemaDraft {
  const next = cloneDraft(draft);
  const found = locate(next, { kind: 'group', key });
  if (found?.group) Object.assign(found.group, patch);
  return next;
}

export function updateItem(draft: SchemaDraft, key: string, patch: Patch<DraftItem>): SchemaDraft {
  const next = cloneDraft(draft);
  const found = locate(next, { kind: 'item', key });
  if (found?.item) Object.assign(found.item, patch);
  return next;
}

export function updateMeta(
  draft: SchemaDraft,
  patch: Partial<Pick<SchemaDraft, 'code' | 'titleMn' | 'titleEn' | 'description'>>,
): SchemaDraft {
  return { ...cloneDraft(draft), ...patch };
}

export function updateScales(draft: SchemaDraft, scales: AssessmentScale[]): SchemaDraft {
  return { ...cloneDraft(draft), scales };
}

export function removeUnclassified(draft: SchemaDraft, index: number): SchemaDraft {
  const next = cloneDraft(draft);
  next.unclassified.splice(index, 1);
  return next;
}

// --- нэмэх ---------------------------------------------------------------

export interface DraftEdit {
  draft: SchemaDraft;
  /** Шинээр үүссэн / нүүсэн зангилаа — UI дээр шууд сонгоно. */
  ref: DraftNodeRef | null;
}

export function addPart(draft: SchemaDraft): DraftEdit {
  const next = cloneDraft(draft);
  const created = newPart(`Асуулга ${next.parts.length + 1}`);
  const section = newSection('');
  section.groups.push(newGroup('', [newItem('')]));
  created.sections.push(section);
  next.parts.push(created);
  return { draft: next, ref: { kind: 'part', key: created.key } };
}

/** `ref` нь part бол төгсгөлд, section бол түүний ард нэмнэ. */
export function addSection(draft: SchemaDraft, ref: DraftNodeRef): DraftEdit {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found) return { draft, ref: null };
  const created = newSection('');
  created.groups.push(newGroup('', [newItem('')]));
  const at = found.sectionIndex >= 0 ? found.sectionIndex + 1 : found.part.sections.length;
  found.part.sections.splice(at, 0, created);
  return { draft: next, ref: { kind: 'section', key: created.key } };
}

export function addGroup(draft: SchemaDraft, ref: DraftNodeRef): DraftEdit {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found?.section) return { draft, ref: null };
  const created = newGroup('', [newItem('')]);
  const at = found.groupIndex >= 0 ? found.groupIndex + 1 : found.section.groups.length;
  found.section.groups.splice(at, 0, created);
  return { draft: next, ref: { kind: 'group', key: created.key } };
}

export function addItem(draft: SchemaDraft, ref: DraftNodeRef): DraftEdit {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found?.group) return { draft, ref: null };
  const created = newItem('');
  const at = found.itemIndex >= 0 ? found.itemIndex + 1 : found.group.items.length;
  found.group.items.splice(at, 0, created);
  return { draft: next, ref: { kind: 'item', key: created.key } };
}

/** Ангилагдаагүй мөрийг сонгосон бүлэгт оноо өгөх мөр болгож оруулна. */
export function adoptUnclassified(
  draft: SchemaDraft,
  index: number,
  target: DraftNodeRef,
): DraftEdit {
  const text = draft.unclassified[index];
  if (text === undefined) return { draft, ref: null };
  const next = cloneDraft(draft);
  const found = locate(next, target);
  if (!found?.group) return { draft, ref: null };
  const created = newItem(text);
  found.group.items.push(created);
  next.unclassified.splice(index, 1);
  return { draft: next, ref: { kind: 'item', key: created.key } };
}

// --- устгах / зөөх --------------------------------------------------------

export function removeNode(draft: SchemaDraft, ref: DraftNodeRef): SchemaDraft {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found) return draft;
  if (ref.kind === 'part') next.parts.splice(found.partIndex, 1);
  else if (ref.kind === 'section') found.part.sections.splice(found.sectionIndex, 1);
  else if (ref.kind === 'group') found.section?.groups.splice(found.groupIndex, 1);
  else found.group?.items.splice(found.itemIndex, 1);
  return next;
}

function moveWithin<T>(list: T[], index: number, delta: number): boolean {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return false;
  const [moved] = list.splice(index, 1);
  if (moved === undefined) return false;
  list.splice(target, 0, moved);
  return true;
}

/** Ах дүү зангилаануудын дунд дээш (-1) / доош (+1) зөөнө. */
export function moveNode(draft: SchemaDraft, ref: DraftNodeRef, delta: -1 | 1): SchemaDraft {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found) return draft;
  let ok = false;
  if (ref.kind === 'part') ok = moveWithin(next.parts, found.partIndex, delta);
  else if (ref.kind === 'section') ok = moveWithin(found.part.sections, found.sectionIndex, delta);
  else if (ref.kind === 'group' && found.section)
    ok = moveWithin(found.section.groups, found.groupIndex, delta);
  else if (ref.kind === 'item' && found.group)
    ok = moveWithin(found.group.items, found.itemIndex, delta);
  return ok ? next : draft;
}

export function canMove(draft: SchemaDraft, ref: DraftNodeRef, delta: -1 | 1): boolean {
  const found = locate(draft, ref);
  if (!found) return false;
  const [index, length] =
    ref.kind === 'part'
      ? [found.partIndex, draft.parts.length]
      : ref.kind === 'section'
        ? [found.sectionIndex, found.part.sections.length]
        : ref.kind === 'group'
          ? [found.groupIndex, found.section?.groups.length ?? 0]
          : [found.itemIndex, found.group?.items.length ?? 0];
  const target = index + delta;
  return index >= 0 && target >= 0 && target < length;
}

// --- түвшин солих --------------------------------------------------------
//
// Дэвшүүлэх нь ЗҮГЭЭР л «энэ мөр үнэндээ гарчиг байсан» гэсэн засвар:
// уг зангилаа эцгээ хоёр хуваана — өөрөө шинэ эцэг болж, ард нь байсан
// ах дүүсээ дагуулж авна.  Буулгах нь яг эсрэг үйлдэл (өмнөх ах руу нэгтгэх).

export function canPromote(draft: SchemaDraft, ref: DraftNodeRef): boolean {
  return ref.kind !== 'part' && locate(draft, ref) !== null;
}

export function canDemote(draft: SchemaDraft, ref: DraftNodeRef): boolean {
  const found = locate(draft, ref);
  if (!found) return false;
  if (ref.kind === 'part') return found.partIndex > 0;
  if (ref.kind === 'section') return found.sectionIndex > 0;
  if (ref.kind === 'group') return found.groupIndex > 0;
  return false; // item-ээс доош түвшин байхгүй.
}

/** item → group,  group → section,  section → part. */
export function promoteNode(draft: SchemaDraft, ref: DraftNodeRef): DraftEdit {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found) return { draft, ref: null };

  if (ref.kind === 'item' && found.group && found.section) {
    const trailing = found.group.items.splice(found.itemIndex);
    const [head, ...rest] = trailing;
    if (!head) return { draft, ref: null };
    const created = newGroup(head.text, rest);
    found.section.groups.splice(found.groupIndex + 1, 0, created);
    return { draft: next, ref: { kind: 'group', key: created.key } };
  }

  if (ref.kind === 'group' && found.section) {
    const trailing = found.section.groups.splice(found.groupIndex);
    const [head] = trailing;
    if (!head) return { draft, ref: null };
    const created = newSection(head.title, trailing);
    found.part.sections.splice(found.sectionIndex + 1, 0, created);
    return { draft: next, ref: { kind: 'section', key: created.key } };
  }

  if (ref.kind === 'section') {
    const trailing = found.part.sections.splice(found.sectionIndex);
    const [head] = trailing;
    if (!head) return { draft, ref: null };
    const created = newPart(head.title, {
      scaleId: found.part.scaleId,
      chart: found.part.chart,
      weighted: found.part.weighted,
      paging: found.part.paging,
      sections: trailing,
    });
    next.parts.splice(found.partIndex + 1, 0, created);
    return { draft: next, ref: { kind: 'part', key: created.key } };
  }

  return { draft, ref: null };
}

/** promoteNode-ийн эсрэг: өмнөх ах дүү рүү нэгтгэнэ. */
export function demoteNode(draft: SchemaDraft, ref: DraftNodeRef): DraftEdit {
  const next = cloneDraft(draft);
  const found = locate(next, ref);
  if (!found) return { draft, ref: null };

  if (ref.kind === 'group' && found.section && found.groupIndex > 0) {
    const prev = found.section.groups[found.groupIndex - 1];
    const self = found.section.groups[found.groupIndex];
    if (!prev || !self) return { draft, ref: null };
    const heading = newItem(self.title);
    prev.items.push(heading, ...self.items);
    found.section.groups.splice(found.groupIndex, 1);
    return { draft: next, ref: { kind: 'item', key: heading.key } };
  }

  if (ref.kind === 'section' && found.sectionIndex > 0) {
    const prev = found.part.sections[found.sectionIndex - 1];
    const self = found.part.sections[found.sectionIndex];
    if (!prev || !self) return { draft, ref: null };
    // Хэсгийн нэр эхний бүлэгтээ аль хэдийн давхардаж байвал (promoteNode ингэж
    // үүсгэдэг) шинэ хоосон бүлэг нэмэхгүй — эсрэг тохиолдолд нэр алдагдахгүйн
    // тулд гарчгийг тусдаа бүлэг болгож хадгална.
    const firstGroup = self.groups[0];
    const titleKept = Boolean(firstGroup && firstGroup.title.trim() === self.title.trim());
    const heading = titleKept ? null : newGroup(self.title, []);
    prev.groups.push(...(heading ? [heading] : []), ...self.groups);
    found.part.sections.splice(found.sectionIndex, 1);
    const landed = heading ?? firstGroup;
    return { draft: next, ref: landed ? { kind: 'group', key: landed.key } : null };
  }

  if (ref.kind === 'part' && found.partIndex > 0) {
    const prev = next.parts[found.partIndex - 1];
    const self = next.parts[found.partIndex];
    if (!prev || !self) return { draft, ref: null };
    const first = self.sections[0];
    prev.sections.push(...self.sections);
    next.parts.splice(found.partIndex, 1);
    return { draft: next, ref: first ? { kind: 'section', key: first.key } : null };
  }

  return { draft, ref: null };
}
