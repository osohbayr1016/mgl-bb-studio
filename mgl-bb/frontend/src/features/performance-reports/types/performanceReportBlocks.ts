/* =============================================================
 * Гүйцэтгэлийн тайлан — block catalogue + content parser.
 * -------------------------------------------------------------
 * Mirrors the landing CMS pattern (`landingBlocks.ts`).  Each
 * block kind has a typed content shape; runtime validation flows
 * through `parseBlockContent()` so missing fields fall back to
 * the typed defaults.  Backend stores `type` and `content_json`
 * opaquely — this file is the single source of truth for shape.
 * ============================================================= */

import {
  parseIntroOverride,
  type IntroOverride,
} from '@/features/performance-reports/types/introOverride';

export const BLOCK_TYPES = [
  'cover',
  'toc',
  'project-intro',
  'team-narrative',
  'team-stats',
  'all-team-stats',
  'execution-summary',
  'project-sections',
  'rich-text',
  'divider',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Cover блокийн засварлагдах талбарууд (бүгд заавал бус — байхгүй талбар = авто). */
export interface CoverOverride {
  projectFullTitle?: string;
  clientName?: string;
  reportNo?: number;
  periodStart?: string;
  periodEnd?: string;
  drawingNo?: string;
}

export interface BlockContentMap {
  cover: { override?: CoverOverride | null };
  toc: Record<string, never>;
  /* «1. Төслийн танилцуулга» — урьд нь бүрэн авто (Record<string, never>)
   * байсан тул хуудсан дээр юу засаад ч хадгалагдах газаргүй байв. Одоо
   * cover-той ижил override загвар: `undefined` талбар = авто утга ялна,
   * бичигдсэн утга (хоосон мөр ч гэсэн) = хэрэглэгчийнх. */
  'project-intro': { override?: IntroOverride | null };
  'team-narrative': { team_code: string };
  'team-stats': { team_code: string };
  'all-team-stats': Record<string, never>;
  'execution-summary': Record<string, never>;
  'project-sections': Record<string, never>;
  'rich-text': { heading: string; body: string };
  divider: { style: 'page-break' | 'hairline' };
}

/** Бүх блокт нийтлэг — preview дээр гараар засварласан СТАТИК шошгууд.
 *  Түлхүүр нь `T` компонентын `k` утга (ж: 'intro.lbl.client'), утга нь
 *  хэрэглэгчийн бичсэн текст.  Хоосон мөр ('') нь «шошгыг зориуд
 *  арилгасан» гэсэн үг тул анхдагчаар дүүргэхгүй.
 *  Нэршлийн дүрмийг `lib/reportText.tsx`-ийн толгойгоос үз.
 *  Backend `content_json`-ыг opaque дамжуулдаг тул migration шаардлагагүй. */
export interface BlockTextOverrides {
  textOverrides?: Record<string, string>;
}

export type BlockContent<T extends BlockType = BlockType> = BlockContentMap[T] &
  BlockTextOverrides;

export interface ReportBlock<T extends BlockType = BlockType> {
  id: number;
  report_id: number;
  type: T;
  position: number;
  content: BlockContent<T>;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

/* Default seed values per kind. Used when:
 *   - the picker drops a fresh block onto the page,
 *   - a saved block is missing a field after schema evolves. */
export const BLOCK_DEFAULTS: { [K in BlockType]: BlockContentMap[K] } = {
  cover: { override: null },
  toc: {} as Record<string, never>,
  'project-intro': { override: null },
  'team-narrative': { team_code: '' },
  'team-stats': { team_code: '' },
  'all-team-stats': {} as Record<string, never>,
  'execution-summary': {} as Record<string, never>,
  'project-sections': {} as Record<string, never>,
  'rich-text': { heading: '', body: '' },
  divider: { style: 'page-break' },
};

/* UI metadata for the block picker + per-block editor. */
export interface BlockTypeMeta {
  label_mn: string;
  group: 'structure' | 'team' | 'content';
  description_mn: string;
  /** When false, the picker hides the kind if one already exists on
   *  the report (cover / TOC / intro / summary / consolidated stats
   *  only make sense once per report). */
  allowedMultiple: boolean;
}

export const BLOCK_TYPE_META: { [K in BlockType]: BlockTypeMeta } = {
  cover: {
    label_mn: 'Нүүр хуудас',
    group: 'structure',
    description_mn:
      'Хар хөх дэвсгэртэй нээх хуудас. Тайлангийн дугаар, хугацаа, төслийн нэр болон Doc.No.',
    allowedMultiple: false,
  },
  toc: {
    label_mn: 'Агуулга',
    group: 'structure',
    description_mn: 'Тайлангийн бүлгүүдийг жагсаасан агуулгын хуудас.',
    allowedMultiple: false,
  },
  'project-intro': {
    label_mn: 'Төслийн танилцуулга',
    group: 'structure',
    description_mn:
      'General Information, бичиг баримт, Scope of work, хугацаа гэх мэт төслийн ерөнхий мэдээлэл.',
    allowedMultiple: false,
  },
  'team-narrative': {
    label_mn: 'Багийн тайлбар бичиг',
    group: 'team',
    description_mn:
      'Сонгосон багийн тайлбар бичиг (5 асуулт + дисциплин тайлан) — багийг сонгоно уу.',
    allowedMultiple: true,
  },
  'team-stats': {
    label_mn: 'Багийн явцын тойм',
    group: 'team',
    description_mn: 'Сонгосон багийн зургийн бүрдлийн биелэлтийн хүснэгт.',
    allowedMultiple: true,
  },
  'all-team-stats': {
    label_mn: 'Нэгтгэсэн явцын тойм',
    group: 'team',
    description_mn: 'Бүх багийн явцын тойм нэгтгэн харуулна.',
    allowedMultiple: false,
  },
  'execution-summary': {
    label_mn: 'Гүйцэтгэх хураангуй ба хугацаа',
    group: 'structure',
    description_mn:
      'Төслийн түлхүүр мэдээлэл + хугацааны stepper (Эхлэх → уулзалтууд → Дуусах) нэг хуудсанд.',
    allowedMultiple: false,
  },
  'project-sections': {
    label_mn: 'Үндэслэл, норм, өрөө, гал',
    group: 'structure',
    description_mn:
      'Төслийн үндэслэл/ангилал, мөрдсөн норм дүрэм, техникийн өрөө, галын аюулгүй байдлын хэсгүүд (бөглөсөн нь л харагдана).',
    allowedMultiple: false,
  },
  'rich-text': {
    label_mn: 'Чөлөөт текст',
    group: 'content',
    description_mn: 'Толгой ба үндсэн өгүүлбэртэй ердийн агуулгын блок.',
    allowedMultiple: true,
  },
  divider: {
    label_mn: 'Тусгаарлагч',
    group: 'content',
    description_mn: 'Хуудасны тасралт эсвэл нимгэн зураас.',
    allowedMultiple: true,
  },
};

/* Tiny client-side id generator — enough entropy for React keys and
 * up/down reordering inside a single browser session. */
export function genId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/* Runtime parser. Always returns a fully populated content object
 * matching the declared type — missing or wrong-typed fields fall
 * back to defaults from BLOCK_DEFAULTS. */
function parseBlockCore<T extends BlockType>(type: T, raw: unknown): BlockContentMap[T] {
  const base = BLOCK_DEFAULTS[type];
  if (!raw || typeof raw !== 'object') return { ...base };
  const r = raw as Record<string, unknown>;
  switch (type) {
    case 'cover': {
      const ov = r.override;
      const override = ov && typeof ov === 'object' ? (ov as CoverOverride) : null;
      return { override } as BlockContentMap[T];
    }
    case 'project-intro': {
      // parseIntroOverride нь буруу төрөлтэй талбарыг чимээгүй хаядаг тул
      // хуучин (эсвэл гараар эвдэрсэн) content ирсэн ч авто утга ялж,
      // танилцуулгын хуудас хэзээ ч хоосорохгүй.
      return { override: parseIntroOverride(r.override) } as BlockContentMap[T];
    }
    case 'team-narrative':
    case 'team-stats': {
      const code = typeof r.team_code === 'string' ? r.team_code : '';
      return { team_code: code } as BlockContentMap[T];
    }
    case 'rich-text': {
      const heading = typeof r.heading === 'string' ? r.heading : '';
      const body = typeof r.body === 'string' ? r.body : '';
      return { heading, body } as BlockContentMap[T];
    }
    case 'divider': {
      const style: 'page-break' | 'hairline' = r.style === 'hairline' ? 'hairline' : 'page-break';
      return { style } as BlockContentMap[T];
    }
    default:
      // toc | all-team-stats | execution-summary | project-sections —
      // өөрийн талбаргүй, бүрэн авто блокууд.
      return { ...base };
  }
}

/** `textOverrides`-ыг цэвэрлэж авна — string биш утгыг чимээгүй хаяна.
 *  Хоосон object бол `undefined` буцааж, шаардлагагүй түлхүүрийг
 *  `content_json`-д бичихээс сэргийлнэ. */
function parseTextOverrides(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/* Нийтийн parser: төрлийн өөрийн талбарууд (parseBlockCore) + БҮХ блокт
 * нийтлэг `textOverrides`.  Урьд нь switch-ийн салаа бүр зөвхөн мэдэгдэх
 * талбарыг буцаадаг байсан тул preview дээр засварласан статик шошго
 * дараагийн уншилтад чимээгүй алга болдог байв — тиймээс шүүлт нь салаа
 * бүрийн үр дүн дээр НЭГ ЖИГД нэмэгддэг. */
export function parseBlockContent<T extends BlockType>(type: T, raw: unknown): BlockContent<T> {
  const core = parseBlockCore(type, raw);
  const textOverrides =
    raw && typeof raw === 'object'
      ? parseTextOverrides((raw as Record<string, unknown>).textOverrides)
      : undefined;
  // Хоосон үед түлхүүрийг огт нэмэхгүй — content_json цэвэр хэвээр үлдэнэ.
  if (!textOverrides) return core as BlockContent<T>;
  return { ...(core as object), textOverrides } as BlockContent<T>;
}

/* Raw block as returned by the backend. The `content` field is
 * already JSON-parsed server-side; we re-validate via
 * parseBlockContent at consumption time. */
export interface ReportBlockRaw {
  id: number;
  report_id: number;
  type: string;
  position: number;
  content: unknown;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

/* Coerce a raw block into a typed one. Unknown `type` strings fall
 * through to `rich-text` with an empty body so future kinds the
 * frontend doesn't know about still render something rather than
 * crashing the page. */
export function coerceBlock(raw: ReportBlockRaw): ReportBlock {
  const type = (BLOCK_TYPES as readonly string[]).includes(raw.type)
    ? (raw.type as BlockType)
    : 'rich-text';
  return {
    id: raw.id,
    report_id: raw.report_id,
    type,
    position: raw.position,
    content: parseBlockContent(type, raw.content),
    hidden: raw.hidden,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  } as ReportBlock;
}
