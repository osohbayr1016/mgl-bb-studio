/**
 * График (recharts SVG) → PNG data URL.
 *
 * Excel export-д графикуудыг зураг болгож оруулах цорын ганц зам. Гадаад
 * сүлжээний хүсэлт ХИЙХГҮЙ (CSP нь бүх гадаад host-ыг хааж байгаа) — DOM дахь
 * SVG-г XMLSerializer-ээр текст болгож, computed style-уудыг клон дээр нь
 * inline бичээд `data:image/svg+xml` зурган дээгүүр canvas руу зурна.
 *
 * Яагаад computed style-уудыг inline бичих ёстой вэ: recharts нь өнгө/фонтоо
 * CSS хувьсагч (`var(--color-border)`), `currentColor` болон өвлүүлсэн
 * `font-family`-ээр авдаг. Салангид SVG баримтад эдгээрийн аль нь ч
 * тодорхойлогдоогүй тул хувьсагчгүй бол тэнхлэг, шошго нь хар/serif болж
 * гардаг. Тиймээс элемент бүрийн бодогдсон утгыг клон руу шууд буулгана.
 *
 * Ямар нэг алдаа гарвал (canvas tainted, зураг ачаалагдахгүй, өргөн 0 гэх мэт)
 * `null` буцаана — дуудагч тал зураггүйгээр үргэлжлүүлнэ.
 */

import type { ChartSection } from '../components/SkillScatterChart';
import { sectionMean, sectionScaleMax } from './behaviorScale';
import type { ChartImageInput, ResultPart } from './exportAssessmentXlsx';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Зураг ачаалахыг хүлээх дээд хугацаа — export хэзээ ч мөлхөж болохгүй. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * Клон руу шууд бичих CSS шинжүүд.
 *
 * Салангид SVG дотор ажиллах ёстой БҮХ paint/typography шинж энд байна.
 * Нэмэлт шинж нэмэхдээ болгоомжтой — элемент бүр дээр бичигддэг тул
 * серизацийн хэмжээ шууд өснө.
 */
const INLINED_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
] as const;

/** Ил тод (өнгөгүй) background утгууд. */
const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i;

function hasStyle(node: Node): node is SVGElement | HTMLElement {
  return node instanceof SVGElement || node instanceof HTMLElement;
}

/**
 * Эх DOM ба клоны элементүүдийг ЯГ ижил дарааллаар нь давхцуулж, эхийн
 * computed утгыг клоны inline style руу хуулна.
 */
function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceNodes: Element[] = [source, ...Array.from(source.querySelectorAll('*'))];
  const cloneNodes: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
  // Урт нь зөрвөл (онолын хувьд болох ёсгүй) хосолгоо буруу болох тул огт
  // хүрэхгүй — өнгөгүй ч гэсэн зөв геометртэй зураг гарсан нь дээр.
  if (sourceNodes.length !== cloneNodes.length) return;

  for (let i = 0; i < sourceNodes.length; i += 1) {
    const src = sourceNodes[i];
    const dst = cloneNodes[i];
    if (!src || !dst || !hasStyle(dst)) continue;
    const computed = window.getComputedStyle(src);
    for (const prop of INLINED_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) dst.style.setProperty(prop, value);
    }
  }
}

/** Хамгийн ойрын ил тод БИШ фоны өнгийг олно (dark горимд бараан гарна). */
function resolveBackground(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const bg = window.getComputedStyle(node).backgroundColor;
    if (bg && !TRANSPARENT.test(bg.trim())) return bg;
    node = node.parentElement;
  }
  return '#ffffff';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error('svg image timeout')), LOAD_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('svg image failed'));
    };
    img.src = src;
  });
}

export interface SvgToPngOptions {
  /**
   * Зурагны ард дүүргэх өнгө. Өгөөгүй бол SVG-ийн эцгүүдээс олно
   * (харанхуй горимд бараан) — `null` өгвөл ил тод үлдэнэ.
   */
  background?: string | null;
}

/**
 * SVG элементийг PNG data URL болгоно. Алдаа гарвал `null`.
 *
 * @param svg   DOM дахь амьд `<svg>` (recharts-ийн `.recharts-surface`).
 * @param scale Пикселийн нягтрал (2 = retina чанар). 1..4 хооронд хумигдана.
 */
export async function svgToPngDataUrl(
  svg: SVGSVGElement | null | undefined,
  scale = 2,
  options: SvgToPngOptions = {},
): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || !svg) return null;

    const rect = svg.getBoundingClientRect();
    const width = Math.round(rect.width || Number(svg.getAttribute('width')) || 0);
    const height = Math.round(rect.height || Number(svg.getAttribute('height')) || 0);
    if (!width || !height) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('xmlns:xlink', XLINK_NS);
    // recharts нь `style="width:100%;height:100%"` тавьдаг — салангид баримтад
    // хувь нь юунаас ч тооцогдохгүй тул устгаад пикселийн хэмжээг үлдээнэ.
    clone.style.removeProperty('width');
    clone.style.removeProperty('height');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    inlineComputedStyles(svg, clone);
    // `currentColor` нь SVG үндсийн `color`-оос шийдэгддэг тул үндэс дээр нь
    // бодогдсон утгыг тавина (inlineComputedStyles-д алдагдсан тохиолдолд ч).
    clone.style.setProperty('color', window.getComputedStyle(svg).color);

    const serialized = new XMLSerializer().serializeToString(clone);
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    const img = await loadImage(src);

    const ratio = Math.max(1, Math.min(scale, 4));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const background = options.background === undefined ? resolveBackground(svg) : options.background;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png');
  } catch {
    // Excel export графикгүйгээр ч гарах ёстой — энд хэзээ ч шидэхгүй.
    return null;
  }
}

/**
 * `data-assessment-chart="<key>"` тэмдэгтэй сав дотрох recharts SVG-г олно.
 *
 * `root`-оор dialog-ийн контейнерийг өгснөөр ижил түлхүүртэй хуудасны
 * график ба dialog-ийн график хоорондоо мөргөлдөхгүй.
 */
export function findChartSvg(
  root: ParentNode | null | undefined,
  key: string,
): SVGSVGElement | null {
  const scope = root ?? (typeof document === 'undefined' ? null : document);
  if (!scope) return null;
  const holder = scope.querySelector(`[data-assessment-chart="${CSS.escape(key)}"]`);
  return holder?.querySelector('svg') ?? null;
}

/** `findChartSvg` + `svgToPngDataUrl` — олдохгүй бол `null`. */
export async function captureChartPng(
  root: ParentNode | null | undefined,
  key: string,
  scale = 2,
): Promise<string | null> {
  return svgToPngDataUrl(findChartSvg(root, key), scale);
}

// ---------------------------------------------------------------------------
// Үнэлгээний графикуудтай ажиллах туслахууд
// ---------------------------------------------------------------------------

/**
 * `data-assessment-chart` түлхүүр. `scope` нь хуудас (`round`) ба dialog
 * (`detail`)-ийн ижил part-ын графикийг ялгана — эс бөгөөс аль нэгийг нь
 * барьж авахад нөгөө нь таарч болзошгүй.
 */
export const chartKeyFor = (scope: string, partId: string): string => `${scope}:${partId}`;

/** Ур чадварын part-ын доорх spider/radar график — scatter-ээс тусдаа түлхүүр. */
export const chartKeyForRadar = (scope: string, partId: string): string =>
  `${scope}:${partId}:radar`;

/** Бодогдсон part → графикийн тэнхлэгүүд. `benchmark` нь section code-оор таарна. */
export function toChartSections(
  part: ResultPart,
  benchmark?: ChartSection[] | null,
): ChartSection[] {
  return part.sections.map((s) => ({
    code: s.code,
    title: s.title,
    selfPct: s.self_pct,
    seniorPct: s.senior_pct,
    averagePct: s.pct,
    benchmarkPct: benchmark?.find((b) => b.code === s.code)?.averagePct ?? null,
    selfMean: sectionMean(s, 'self'),
    seniorMean: sectionMean(s, 'senior'),
    averageMean: sectionMean(s, 'average'),
    scaleMax: sectionScaleMax(s),
    benchmarkMean: benchmark?.find((b) => b.code === s.code)?.averageMean ?? null,
  }));
}

/**
 * Дэлгэц дээр яг одоо байгаа графикуудыг PNG болгож цуглуулна.
 *
 * SVG олдохгүй (жишээ нь таб хаалттай) бол тухайн зураг `null` — Excel нь
 * зураггүйгээр, тоон хүснэгтүүдээ бүрэн агуулж гарна.
 */
export async function captureParts(
  root: ParentNode | null,
  parts: ResultPart[],
  scope: string,
  viewLabel: string,
  radarTitleSuffix = ' · Radar',
): Promise<ChartImageInput[]> {
  const out: ChartImageInput[] = [];
  for (const part of parts) {
    const pushCapture = async (key: string, title: string, kind: 'main' | 'radar') => {
      const svg = findChartSvg(root, key);
      const rect = svg?.getBoundingClientRect();
      out.push({
        title,
        dataUrl: await svgToPngDataUrl(svg, 2),
        width: rect?.width ? Math.round(rect.width) : undefined,
        height: rect?.height ? Math.round(rect.height) : undefined,
        partId: part.part_id,
        kind,
      });
    };

    await pushCapture(chartKeyFor(scope, part.part_id), `${part.title} — ${viewLabel}`, 'main');

    if (part.chart === 'scatter' && part.weighted) {
      await pushCapture(
        chartKeyForRadar(scope, part.part_id),
        `${part.title}${radarTitleSuffix} — ${viewLabel}`,
        'radar',
      );
    }
  }
  return out;
}

/** Scatter + radar хос (ур чадвар эсвэл зан чанар) — Excel export-д. */
export async function captureDualChartsForPart(
  root: ParentNode | null,
  part: ResultPart,
  scope: string,
  viewLabel: string,
  radarTitleSuffix = ' · Radar',
): Promise<ChartImageInput[]> {
  const out: ChartImageInput[] = [];
  const push = async (key: string, title: string, kind: 'main' | 'radar') => {
    const svg = findChartSvg(root, key);
    const rect = svg?.getBoundingClientRect();
    out.push({
      title,
      dataUrl: await svgToPngDataUrl(svg, 2),
      width: rect?.width ? Math.round(rect.width) : undefined,
      height: rect?.height ? Math.round(rect.height) : undefined,
      partId: part.part_id,
      kind,
    });
  };
  await push(chartKeyFor(scope, part.part_id), `${part.title} — ${viewLabel}`, 'main');
  await push(
    chartKeyForRadar(scope, part.part_id),
    `${part.title}${radarTitleSuffix} — ${viewLabel}`,
    'radar',
  );
  return out;
}

/**
 * Live дэлгэц дээрх графикийн хэмжээг (`w`×`h`) нэг лэйн дотор багтаах хэмжээ
 * болгож хумина — өндрийг ижил харьцаагаар нь бууруулна. Зөвхөн Excel-д
 * ЗУРАХ мөчид дуудна (barих зурган дээрх дата URL-ыг өөрчлөхгүй).
 */
export function fitChartBox(
  w: number | undefined,
  h: number | undefined,
  maxW: number,
  fallbackW = 760,
  fallbackH = 360,
) {
  const width = w && w > 0 ? w : fallbackW;
  const height = h && h > 0 ? h : fallbackH;
  if (width <= maxW) return { width: Math.round(width), height: Math.round(height) };
  const k = maxW / width;
  return { width: Math.round(maxW), height: Math.round(height * k) };
}
