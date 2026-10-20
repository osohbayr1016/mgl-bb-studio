export type SideKey = 'self' | 'senior' | 'average' | 'benchmark';

export function seriesVisualOpacity(side: SideKey, hovered: SideKey | null): number {
  if (hovered === null) return 1;
  return hovered === side ? 1 : 0.14;
}

/**
 * Цуваа бүрийн үндсэн зузаан — БҮГД ижил байхаа больсон.
 *
 * Өмнө нь дөрвүүлээ 2px байсан тул график нь ялгаагүй нимгэн шугамын
 * шигүү тор болж, аль нь аль болохыг зөвхөн өнгөөр нь ялгах шаардлагатай
 * байв. Одоо зузаан нь ЭРЭМБИЙН дохио болно:
 *
 *   average   6px — «Дундаж» бол ГОЛ хариулт, хамгийн түрүүнд нүдэнд тусна.
 *   senior    3px — ахлагчийн үнэлгээ, тайлбарлах гол хоёр цувааны нэг.
 *   self      3px — ажилтны өөрийн үнэлгээ, ахлагчийнхтай ижил жинтэй тул
 *                   ижил зузаан (зөрүү нь өнгөөр илэрнэ).
 *   benchmark 2px — багийн дундаж бол зөвхөн жишиг; хамгийн нимгэн бөгөөд
 *                   тасархай (`BENCHMARK_DASH`) тул ард нь ухарна.
 *
 * Render-ийн дараалал (`SkillScatterChart`-ийн `activeSides`) нь benchmark →
 * self → senior → average тул зузаан нь бүдүүрэх тусам ДЭЭР зурагдана.
 */
const BASE_STROKE_WIDTH: Record<SideKey, number> = {
  average: 6,
  senior: 3,
  self: 3,
  benchmark: 2,
};

/** Hover үед нэмэгдэх зузаан — цуваа сонгогдсоныг мэдрүүлнэ. */
const HOVER_BOOST = 1.5;

export function seriesStrokeWidth(side: SideKey, hovered: SideKey | null): number {
  const base = BASE_STROKE_WIDTH[side];
  return hovered === side ? base + HOVER_BOOST : base;
}
