/** Shared constants for the ProjectDetailPage tree.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */

/** The 10 official drawing-discipline codes used across Mongolian project
 *  documentation. Order here is the canonical display order — used both for
 *  the data-grid tabs in the project overview and for the team-claim mapping
 *  on the backend. The tuple keys must stay aligned with the seed values in
 *  the backend's `teams` table. */
export const DRAWING_DISCIPLINES = [
  { code: 'BA', label: 'Барилга архитектур' },
  { code: 'BB', label: 'Барилга бүтээц' },
  { code: 'TSAH', label: 'Цахилгаан' },
  { code: 'HAS', label: 'Халаалт агаар сэлгэлт' },
  { code: 'TSBU', label: 'Цэвэр бохир ус' },
  { code: 'HD', label: 'Холбоо дохиолол' },
  { code: 'AU', label: 'Автомат удирдлага' },
  { code: 'EZ', label: 'Эскиз зураг' },
  { code: 'IZ', label: 'Интерьер зураг' },
  { code: 'GT', label: 'Гадна тохижилт' },
] as const;

/** Per-discipline accent palette.  The little colored dot on the team
 *  tab + the chip on the discipline cell pull from here so the same
 *  team always reads the same color across the page. */
export const DISCIPLINE_DOT: Record<string, string> = {
  BA: 'bg-sky-500',
  BB: 'bg-amber-500',
  HAS: 'bg-cyan-500',
  TSBU: 'bg-teal-500',
  TSAH: 'bg-yellow-500',
  HD: 'bg-purple-500',
  AU: 'bg-pink-500',
  EZ: 'bg-lime-500',
  IZ: 'bg-rose-500',
  GT: 'bg-emerald-500',
};

export const TEAM_PREFIX_CODES = DRAWING_DISCIPLINES.map((d) => d.code);
export const DRAWING_DISCIPLINE_LABEL = new Map<string, string>(
  DRAWING_DISCIPLINES.map((d) => [d.code, d.label]),
);

export const BLOCK_ACCENTS = [
  {
    border: 'border-sky-500/50',
    ring: 'ring-sky-500/50',
    bg: 'bg-sky-500/10',
    text: 'text-sky-500',
    solid: 'bg-sky-500',
    soft: 'from-sky-500/25 to-sky-500/5',
  },
  {
    border: 'border-amber-500/50',
    ring: 'ring-amber-500/50',
    bg: 'bg-amber-500/10',
    text: 'text-amber-500',
    solid: 'bg-amber-500',
    soft: 'from-amber-500/25 to-amber-500/5',
  },
  {
    border: 'border-emerald-500/50',
    ring: 'ring-emerald-500/50',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-500',
    solid: 'bg-emerald-500',
    soft: 'from-emerald-500/25 to-emerald-500/5',
  },
  {
    border: 'border-violet-500/50',
    ring: 'ring-violet-500/50',
    bg: 'bg-violet-500/10',
    text: 'text-violet-500',
    solid: 'bg-violet-500',
    soft: 'from-violet-500/25 to-violet-500/5',
  },
  {
    border: 'border-rose-500/50',
    ring: 'ring-rose-500/50',
    bg: 'bg-rose-500/10',
    text: 'text-rose-500',
    solid: 'bg-rose-500',
    soft: 'from-rose-500/25 to-rose-500/5',
  },
  {
    border: 'border-cyan-500/50',
    ring: 'ring-cyan-500/50',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-500',
    solid: 'bg-cyan-500',
    soft: 'from-cyan-500/25 to-cyan-500/5',
  },
] as const;

/** `?tab=` дээр зөвшөөрөгдөх утгууд — танихгүй утга «overview» рүү унана. */
export const PROJECT_TABS = new Set([
  'overview',
  'deadlines',
  'info',
  'mail',
  'report',
  /* «Баримт бичиг» — Google Drive хавтас (features/projects/drive). */
  'documents',
  'charts',
  'asr',
  /* ⚠️ «Бэлэн байдал».  `ProjectTabs.tsx:119` нь энэ табыг ҮРГЭЛЖ (эрхийн
   * шүүлтгүй) render хийдэг атал энэ багц дотор БАЙГААГҮЙ тул
   * `?tab=readiness` гэсэн бүх гүн холбоос чимээгүйхэн «overview» руу
   * унадаг байв — мэдэгдэл болон хайлтын илэрц хоёулаа буруу таб дээр
   * бууж байсан гэсэн үг. */
  'readiness',
  /* «Захиалагч» ('client') таб 2026-09-28-нд хасагдсан (эзний хүсэлт) — хуучин
   * `?tab=client` холбоос (жишээ нь `clientPortal.ts`-ийн мэдэгдэл) «overview»
   * руу унана.  Сэргээх бол `ProjectTabs.tsx`-ийн тайлбарыг үз. */
]);
