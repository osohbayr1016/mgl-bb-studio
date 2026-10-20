/**
 * Block-based landing CMS — type definitions, defaults, and a runtime validator.
 *
 * The DB stores `landing_blocks.content` as a JSON blob whose shape varies by
 * `type`. There's no compile-time link between the TS shape here and the
 * persisted JSON, so every read path MUST go through `parseBlockContent()`,
 * which fills any missing fields from typed defaults and discards unknown
 * shapes. This is what protects the renderer when an old block predates a
 * schema change.
 *
 * Imported by both the public renderer and the admin editor; treat it as
 * the single source of truth for block-content shapes.
 */

/* ------------------------------------------------------------------ */
/*  Page shape                                                         */
/* ------------------------------------------------------------------ */

export interface LandingPage {
  id: number;
  slug: string; // 'home' | 'work/<legacy-id>'
  kind: 'home' | 'project';
  title_mn: string;
  title_en: string;
  meta_json: string; // JSON; not parsed at this layer
  published: number; // 0 | 1
  created_at: string;
  updated_at: string;
  updated_by?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Block type enum                                                    */
/* ------------------------------------------------------------------ */

export const BLOCK_TYPES = [
  'hero',
  'project-grid',
  'services',
  'about',
  'stats',
  'awards',
  'partners',
  'news',
  'contact',
  'rich-text',
  'image',
  'image-gallery',
  'divider',
  'cta',
  'project-credits',
  'image-comparison',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/* ------------------------------------------------------------------ */
/*  Per-block content shapes                                           */
/*                                                                     */
/*  Bilingual fields use _mn/_en pairs. Image URLs are stored as       */
/*  string (R2 /media path or absolute https). Nullable strings        */
/*  represent "not set" — the renderer treats them as empty.           */
/* ------------------------------------------------------------------ */

export interface HeroContent {
  title_mn: string;
  title_en: string;
  subtitle_mn: string;
  subtitle_en: string;
  image_url: string | null;
  video_url: string | null;
  cta_label_mn: string;
  cta_label_en: string;
  cta_anchor: string; // section id or '' for no CTA
}

export interface ProjectGridContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  intro_mn: string;
  intro_en: string;
  project_page_ids: number[]; // ordered refs to landing_pages (kind='project')
}

export interface ServiceItem {
  title_mn: string;
  title_en: string;
  body_mn: string;
  body_en: string;
  icon: string | null; // lucide icon name (e.g. "Layers3")
}

export interface ServicesContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  intro_mn: string;
  intro_en: string;
  items: ServiceItem[];
}

export interface AboutContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  body_mn: string;
  body_en: string;
  image_url: string | null;
}

export interface StatTile {
  value: string; // "15+", "60+", "200+", "4"
  label_mn: string;
  label_en: string;
}

export interface StatsContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  tiles: StatTile[];
}

export interface AwardItem {
  title_mn: string;
  title_en: string;
  tag_mn: string;
  tag_en: string;
  image_url: string | null;
}

export interface AwardsContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  intro_mn: string;
  intro_en: string;
  items: AwardItem[];
}

export interface PartnerItem {
  name: string; // single-language; partner brand names are universal
  image_url: string | null;
  link_url: string | null;
}

export interface PartnersContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  intro_mn: string;
  intro_en: string;
  items: PartnerItem[];
}

export interface NewsItem {
  title_mn: string;
  title_en: string;
  excerpt_mn: string;
  excerpt_en: string;
  image_url: string | null;
  published_at: string; // ISO-ish — what `new Date(...)` accepts
  link_url: string | null;
}

export interface NewsContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  items: NewsItem[];
}

export interface ContactContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  intro_mn: string;
  intro_en: string;
  phone: string | null;
  email: string | null;
  address_mn: string | null;
  address_en: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
}

export interface RichTextContent {
  body_mn: string;
  body_en: string;
}

export type ImageAspect = '16/10' | '4/5' | '1/1';

export interface ImageContent {
  image_url: string | null;
  caption_mn: string;
  caption_en: string;
  aspect: ImageAspect;
}

export interface GalleryImage {
  image_url: string | null;
  caption_mn: string;
  caption_en: string;
}

export interface ImageGalleryContent {
  images: GalleryImage[];
}

export type DividerStyle = 'hairline' | 'section-break';

export interface DividerContent {
  style: DividerStyle;
}

export interface CtaContent {
  eyebrow_mn: string;
  eyebrow_en: string;
  heading_mn: string;
  heading_en: string;
  body_mn: string;
  body_en: string;
  button_label_mn: string;
  button_label_en: string;
  button_href: string;
}

/** Project-detail credits ledger. Mirrors the columns added in
 *  migration 0071 — typology/status/size/client/design_team plus
 *  category/location/year and a philosophy paragraph. */
export interface ProjectCreditsContent {
  name_mn: string;
  name_en: string;
  typology_mn: string | null;
  typology_en: string | null;
  location_mn: string | null;
  location_en: string | null;
  year: string | null;
  status_mn: string | null;
  status_en: string | null;
  size_mn: string | null;
  size_en: string | null;
  client_mn: string | null;
  client_en: string | null;
  design_team_mn: string | null;
  design_team_en: string | null;
  category_mn: string | null;
  category_en: string | null;
  philosophy_mn: string;
  philosophy_en: string;
}

export interface ImageComparisonContent {
  section_label_mn: string;
  section_label_en: string;
  heading_mn: string;
  heading_en: string;
  intro_mn: string;
  intro_en: string;
  image_left_url: string | null; // Blueprint / Plan
  image_right_url: string | null; // Photo / Realization
  label_left_mn: string;
  label_left_en: string;
  label_right_mn: string;
  label_right_en: string;
}

/* ------------------------------------------------------------------ */
/*  Discriminated union                                                */
/* ------------------------------------------------------------------ */

export type BlockContentByType = {
  hero: HeroContent;
  'project-grid': ProjectGridContent;
  services: ServicesContent;
  about: AboutContent;
  stats: StatsContent;
  awards: AwardsContent;
  partners: PartnersContent;
  news: NewsContent;
  contact: ContactContent;
  'rich-text': RichTextContent;
  image: ImageContent;
  'image-gallery': ImageGalleryContent;
  divider: DividerContent;
  cta: CtaContent;
  'project-credits': ProjectCreditsContent;
  'image-comparison': ImageComparisonContent;
};

export interface LandingBlock<T extends BlockType = BlockType> {
  id: number;
  page_id: number;
  type: T;
  position: number;
  content: BlockContentByType[T];
  hidden: number; // 0 | 1
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/*  Primitive coercers                                                 */
/*                                                                     */
/*  Trust nothing. Every read path goes through these.                 */
/* ------------------------------------------------------------------ */

function asString(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : def;
}

function asNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
  }
  return out;
}

function asEnum<E extends string>(v: unknown, allowed: readonly E[], def: E): E {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as E) : def;
}

/* ------------------------------------------------------------------ */
/*  Per-type parsers                                                   */
/* ------------------------------------------------------------------ */

function parseHero(raw: unknown): HeroContent {
  const o = asObject(raw);
  return {
    title_mn: asString(o.title_mn),
    title_en: asString(o.title_en),
    subtitle_mn: asString(o.subtitle_mn),
    subtitle_en: asString(o.subtitle_en),
    image_url: asNullableString(o.image_url),
    video_url: asNullableString(o.video_url),
    cta_label_mn: asString(o.cta_label_mn),
    cta_label_en: asString(o.cta_label_en),
    cta_anchor: asString(o.cta_anchor),
  };
}

function parseProjectGrid(raw: unknown): ProjectGridContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    intro_mn: asString(o.intro_mn),
    intro_en: asString(o.intro_en),
    project_page_ids: asNumberArray(o.project_page_ids),
  };
}

function parseServiceItem(raw: unknown): ServiceItem {
  const o = asObject(raw);
  return {
    title_mn: asString(o.title_mn),
    title_en: asString(o.title_en),
    body_mn: asString(o.body_mn),
    body_en: asString(o.body_en),
    icon: asNullableString(o.icon),
  };
}

function parseServices(raw: unknown): ServicesContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    intro_mn: asString(o.intro_mn),
    intro_en: asString(o.intro_en),
    items: asArray(o.items).map(parseServiceItem),
  };
}

function parseAbout(raw: unknown): AboutContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    body_mn: asString(o.body_mn),
    body_en: asString(o.body_en),
    image_url: asNullableString(o.image_url),
  };
}

function parseStatTile(raw: unknown): StatTile {
  const o = asObject(raw);
  return {
    value: asString(o.value),
    label_mn: asString(o.label_mn),
    label_en: asString(o.label_en),
  };
}

function parseStats(raw: unknown): StatsContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    tiles: asArray(o.tiles).map(parseStatTile),
  };
}

function parseAwardItem(raw: unknown): AwardItem {
  const o = asObject(raw);
  return {
    title_mn: asString(o.title_mn),
    title_en: asString(o.title_en),
    tag_mn: asString(o.tag_mn),
    tag_en: asString(o.tag_en),
    image_url: asNullableString(o.image_url),
  };
}

function parseAwards(raw: unknown): AwardsContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    intro_mn: asString(o.intro_mn),
    intro_en: asString(o.intro_en),
    items: asArray(o.items).map(parseAwardItem),
  };
}

function parsePartnerItem(raw: unknown): PartnerItem {
  const o = asObject(raw);
  return {
    name: asString(o.name),
    image_url: asNullableString(o.image_url),
    link_url: asNullableString(o.link_url),
  };
}

function parsePartners(raw: unknown): PartnersContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    intro_mn: asString(o.intro_mn),
    intro_en: asString(o.intro_en),
    items: asArray(o.items).map(parsePartnerItem),
  };
}

function parseNewsItem(raw: unknown): NewsItem {
  const o = asObject(raw);
  return {
    title_mn: asString(o.title_mn),
    title_en: asString(o.title_en),
    excerpt_mn: asString(o.excerpt_mn),
    excerpt_en: asString(o.excerpt_en),
    image_url: asNullableString(o.image_url),
    published_at: asString(o.published_at),
    link_url: asNullableString(o.link_url),
  };
}

function parseNews(raw: unknown): NewsContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    items: asArray(o.items).map(parseNewsItem),
  };
}

function parseContact(raw: unknown): ContactContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    intro_mn: asString(o.intro_mn),
    intro_en: asString(o.intro_en),
    phone: asNullableString(o.phone),
    email: asNullableString(o.email),
    address_mn: asNullableString(o.address_mn),
    address_en: asNullableString(o.address_en),
    facebook_url: asNullableString(o.facebook_url),
    linkedin_url: asNullableString(o.linkedin_url),
    instagram_url: asNullableString(o.instagram_url),
  };
}

function parseRichText(raw: unknown): RichTextContent {
  const o = asObject(raw);
  return {
    body_mn: asString(o.body_mn),
    body_en: asString(o.body_en),
  };
}

const IMAGE_ASPECTS: readonly ImageAspect[] = ['16/10', '4/5', '1/1'];

function parseImage(raw: unknown): ImageContent {
  const o = asObject(raw);
  return {
    image_url: asNullableString(o.image_url),
    caption_mn: asString(o.caption_mn),
    caption_en: asString(o.caption_en),
    aspect: asEnum<ImageAspect>(o.aspect, IMAGE_ASPECTS, '16/10'),
  };
}

function parseGalleryImage(raw: unknown): GalleryImage {
  const o = asObject(raw);
  return {
    image_url: asNullableString(o.image_url),
    caption_mn: asString(o.caption_mn),
    caption_en: asString(o.caption_en),
  };
}

function parseImageGallery(raw: unknown): ImageGalleryContent {
  const o = asObject(raw);
  return {
    images: asArray(o.images).map(parseGalleryImage),
  };
}

const DIVIDER_STYLES: readonly DividerStyle[] = ['hairline', 'section-break'];

function parseDivider(raw: unknown): DividerContent {
  const o = asObject(raw);
  return {
    style: asEnum<DividerStyle>(o.style, DIVIDER_STYLES, 'hairline'),
  };
}

function parseCta(raw: unknown): CtaContent {
  const o = asObject(raw);
  return {
    eyebrow_mn: asString(o.eyebrow_mn),
    eyebrow_en: asString(o.eyebrow_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    body_mn: asString(o.body_mn),
    body_en: asString(o.body_en),
    button_label_mn: asString(o.button_label_mn),
    button_label_en: asString(o.button_label_en),
    button_href: asString(o.button_href),
  };
}

function parseProjectCredits(raw: unknown): ProjectCreditsContent {
  const o = asObject(raw);
  return {
    name_mn: asString(o.name_mn),
    name_en: asString(o.name_en),
    typology_mn: asNullableString(o.typology_mn),
    typology_en: asNullableString(o.typology_en),
    location_mn: asNullableString(o.location_mn),
    location_en: asNullableString(o.location_en),
    year: asNullableString(o.year),
    status_mn: asNullableString(o.status_mn),
    status_en: asNullableString(o.status_en),
    size_mn: asNullableString(o.size_mn),
    size_en: asNullableString(o.size_en),
    client_mn: asNullableString(o.client_mn),
    client_en: asNullableString(o.client_en),
    design_team_mn: asNullableString(o.design_team_mn),
    design_team_en: asNullableString(o.design_team_en),
    category_mn: asNullableString(o.category_mn),
    category_en: asNullableString(o.category_en),
    philosophy_mn: asString(o.philosophy_mn),
    philosophy_en: asString(o.philosophy_en),
  };
}

function parseImageComparison(raw: unknown): ImageComparisonContent {
  const o = asObject(raw);
  return {
    section_label_mn: asString(o.section_label_mn),
    section_label_en: asString(o.section_label_en),
    heading_mn: asString(o.heading_mn),
    heading_en: asString(o.heading_en),
    intro_mn: asString(o.intro_mn),
    intro_en: asString(o.intro_en),
    image_left_url: asNullableString(o.image_left_url),
    image_right_url: asNullableString(o.image_right_url),
    label_left_mn: asString(o.label_left_mn),
    label_left_en: asString(o.label_left_en),
    label_right_mn: asString(o.label_right_mn),
    label_right_en: asString(o.label_right_en),
  };
}

/* ------------------------------------------------------------------ */
/*  Public parser API                                                  */
/* ------------------------------------------------------------------ */

const PARSERS = {
  hero: parseHero,
  'project-grid': parseProjectGrid,
  services: parseServices,
  about: parseAbout,
  stats: parseStats,
  awards: parseAwards,
  partners: parsePartners,
  news: parseNews,
  contact: parseContact,
  'rich-text': parseRichText,
  image: parseImage,
  'image-gallery': parseImageGallery,
  divider: parseDivider,
  cta: parseCta,
  'project-credits': parseProjectCredits,
  'image-comparison': parseImageComparison,
} as const satisfies { [K in BlockType]: (raw: unknown) => BlockContentByType[K] };

/** Parse a raw `content` payload against the typed shape for `type`.
 *  Missing fields are filled from typed defaults; unknown shapes are
 *  discarded. Never throws — the renderer can trust the result. */
export function parseBlockContent<T extends BlockType>(
  type: T,
  raw: unknown,
): BlockContentByType[T] {
  const parser = PARSERS[type] as (r: unknown) => BlockContentByType[T];
  return parser(raw);
}

/** Default content for a brand-new block of `type`. Derived from the
 *  parser running over `{}`, so defaults and the parser can't drift. */
export const BLOCK_DEFAULTS = Object.fromEntries(BLOCK_TYPES.map((t) => [t, PARSERS[t]({})])) as {
  [K in BlockType]: BlockContentByType[K];
};

/* ------------------------------------------------------------------ */
/*  Block metadata for the admin block picker                          */
/* ------------------------------------------------------------------ */

export type BlockGroup = 'section' | 'building-block';

export interface BlockTypeMeta {
  type: BlockType;
  friendly_mn: string;
  friendly_en: string;
  description_mn: string;
  description_en: string;
  icon: string; // lucide icon name
  group: BlockGroup;
  projectPagesOnly?: boolean;
}

export const BLOCK_TYPE_META: { [K in BlockType]: BlockTypeMeta } = {
  hero: {
    type: 'hero',
    icon: 'Image',
    group: 'section',
    friendly_mn: 'Hero',
    friendly_en: 'Hero',
    description_mn: 'Том баннер зураг + гарчиг',
    description_en: 'Full-bleed banner image + title',
  },
  'project-grid': {
    type: 'project-grid',
    icon: 'LayoutGrid',
    group: 'section',
    friendly_mn: 'Төслүүдийн жагсаалт',
    friendly_en: 'Project grid',
    description_mn: 'Сонгомол төслүүдийн товч жагсаалт',
    description_en: 'A selected list of project cards',
  },
  services: {
    type: 'services',
    icon: 'Layers3',
    group: 'section',
    friendly_mn: 'Үйлчилгээ',
    friendly_en: 'Capabilities',
    description_mn: 'Үйлчилгээ, чадавхийн жагсаалт',
    description_en: 'Service / capability rows',
  },
  about: {
    type: 'about',
    icon: 'Info',
    group: 'section',
    friendly_mn: 'Бидний тухай',
    friendly_en: 'About',
    description_mn: 'Гарчиг + урт текст + зураг',
    description_en: 'Heading + long copy + photo',
  },
  stats: {
    type: 'stats',
    icon: 'Hash',
    group: 'section',
    friendly_mn: 'Тоо баримт',
    friendly_en: 'Statistics',
    description_mn: '4 тоон үзүүлэлт (жил, төсөл, ажилтан, чиглэл)',
    description_en: 'Four large stat tiles',
  },
  awards: {
    type: 'awards',
    icon: 'Award',
    group: 'section',
    friendly_mn: 'Шагнал, хүлээн зөвшөөрөл',
    friendly_en: 'Recognition',
    description_mn: 'Шагнал, гэрчилгээний хэвлэл',
    description_en: 'Award cards with imagery',
  },
  partners: {
    type: 'partners',
    icon: 'Handshake',
    group: 'section',
    friendly_mn: 'Түншүүд',
    friendly_en: 'Partners',
    description_mn: 'Логонуудын эгнээ',
    description_en: 'A row of partner logos',
  },
  news: {
    type: 'news',
    icon: 'Newspaper',
    group: 'section',
    friendly_mn: 'Мэдээ',
    friendly_en: 'News',
    description_mn: 'Мэдээ, эссэний жагсаалт',
    description_en: 'News / blog cards',
  },
  contact: {
    type: 'contact',
    icon: 'Mail',
    group: 'section',
    friendly_mn: 'Холбоо барих',
    friendly_en: 'Contact',
    description_mn: 'Утас, имэйл, хаяг, нийгмийн сүлжээ',
    description_en: 'Phone, email, address, socials',
  },
  'rich-text': {
    type: 'rich-text',
    icon: 'Type',
    group: 'building-block',
    friendly_mn: 'Текст блок',
    friendly_en: 'Rich text',
    description_mn: 'Урт хэлбэрийн текст',
    description_en: 'Long-form paragraph',
  },
  image: {
    type: 'image',
    icon: 'ImageIcon',
    group: 'building-block',
    friendly_mn: 'Зураг',
    friendly_en: 'Image',
    description_mn: 'Нэг зураг + тайлбар',
    description_en: 'Single image with caption',
  },
  'image-gallery': {
    type: 'image-gallery',
    icon: 'Images',
    group: 'building-block',
    friendly_mn: 'Зургийн цуглуулга',
    friendly_en: 'Image gallery',
    description_mn: 'Олон зургийн мозайк',
    description_en: 'Multiple-image mosaic',
  },
  divider: {
    type: 'divider',
    icon: 'Minus',
    group: 'building-block',
    friendly_mn: 'Зураас',
    friendly_en: 'Divider',
    description_mn: 'Хэсгүүдийг тусгаарлах зураас',
    description_en: 'Separates sections',
  },
  cta: {
    type: 'cta',
    icon: 'MousePointerClick',
    group: 'building-block',
    friendly_mn: 'Дуудлага (CTA)',
    friendly_en: 'Call to action',
    description_mn: 'Гарчиг + текст + товчлуур',
    description_en: 'Heading + body + button',
  },
  'project-credits': {
    type: 'project-credits',
    icon: 'FileText',
    group: 'section',
    friendly_mn: 'Төслийн товч мэдээлэл',
    friendly_en: 'Project credits',
    description_mn: 'Барилгын төрөл, статус, үйлчлүүлэгч, баг г.м.',
    description_en: 'Typology, status, client, design team, etc.',
    projectPagesOnly: true,
  },
  'image-comparison': {
    type: 'image-comparison',
    icon: 'Split',
    group: 'section',
    friendly_mn: 'Зураг харьцуулах (Слайдер)',
    friendly_en: 'Image comparison slider',
    description_mn: 'Эскиз болон бодит зураг харьцуулах слайдер',
    description_en: 'Interactive comparison slider for plan vs. realization',
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers shared by the renderer + editor                            */
/* ------------------------------------------------------------------ */

/** True if `type` should not be offered on home pages (admin block picker
 *  filters by this). */
export function isProjectPageOnly(type: BlockType): boolean {
  return BLOCK_TYPE_META[type].projectPagesOnly === true;
}

/** Pick the language-correct text from a bilingual pair. Falls back to
 *  the other language if the requested one is empty — keeps the public
 *  site from showing blanks when the admin only filled in one side. */
export function pickLang(mn: string, en: string, lang: 'mn' | 'en'): string {
  if (lang === 'mn') return mn || en;
  return en || mn;
}
