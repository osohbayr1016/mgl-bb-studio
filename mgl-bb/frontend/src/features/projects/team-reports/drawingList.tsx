import { createContext, useContext, useMemo } from 'react';
import type {
  TeamTemplateOverrides,
} from '@/features/report-templates/types/teamTemplateOverrides';
import type { FieldDef, SectionDef } from '@/features/projects/team-reports/types';

/* =============================================================
 * Зургийн жагсаалт — нийтлэг нэмэлт мөр + PDF интеграцийн гол модуль.
 * -------------------------------------------------------------
 * Баг бүрийн Document (8 файл) "Зургийн жагсаалт"-аа хатуу бичсэн
 * DRAWING_LIST_ROWS-оос зурдаг байсан тул (а) admin/senior-ийн нэмсэн
 * нийтлэг мөр (team_drawing_items, migration 0121), (б) «Загвар засах»-ын
 * нэрийн override хэвлэлд гардаггүй байв. Энэ модуль нэг resolver-ийг
 * context-оор түгээнэ: Document бүр өөрийн үндсэн мөрөө дамжуулж, override
 * нэр + нэмэлт мөрөө хүлээж авна. Provider байхгүй үед (жишээ:
 * TemplatePreview-ийн stub) үндсэн мөрүүд хэвээр — хуучин зан.
 * ============================================================= */

/** GET /api/team-drawing-items-ийн нэг мөр. */
export interface TeamDrawingItem {
  id: number;
  team_code: string;
  /** Checkbox хариултын тогтвортой түлхүүр ('dl_custom_…') — immutable. */
  key: string;
  label: string;
  position: number;
}

export interface TeamDrawingItemsResponse {
  items: TeamDrawingItem[];
}

/** TanStack query key — каталог ховор өөрчлөгддөг тул staleTime: Infinity. */
export const TEAM_DRAWING_ITEMS_KEY = ['/team-drawing-items'] as const;

/** Document-уудын хатуу жагсаалтын мөрийн нийтлэг хэлбэр. */
export interface DrawingRow {
  no: number;
  key: string;
  label: string;
}

export type DrawingRowsResolver = (
  teamCode: string,
  baseRows: ReadonlyArray<DrawingRow>,
) => DrawingRow[];

export const DrawingListContext = createContext<DrawingRowsResolver | null>(null);

/** Document доторх hook: үндсэн мөрүүдээ өгөөд эцсийн (override нэртэй +
 *  нэмэлттэй) жагсаалтаа авна. Provider байхгүй бол үндсэн мөр хэвээр. */
export function useDrawingRows(
  teamCode: string,
  baseRows: ReadonlyArray<{ no: number; key: string; label: string }>,
): DrawingRow[] {
  const resolve = useContext(DrawingListContext);
  return useMemo(
    () => (resolve ? resolve(teamCode, baseRows as ReadonlyArray<DrawingRow>) : [...baseRows]),
    [resolve, teamCode, baseRows],
  );
}

/** Формын label-ууд «1. …» дугаар агуулдаг тул override/гар оруулгын
 *  эхний дугаарыг хусна — doc нь өөрөө {no}. гэж дугаарладаг (давхардахгүй). */
export function stripLeadingNo(label: string): string {
  return label.replace(/^\s*\d+\s*[.)]\s*/, '').trim();
}

export function groupItemsByTeam(
  items: TeamDrawingItem[] | undefined,
): Record<string, TeamDrawingItem[]> {
  const byTeam: Record<string, TeamDrawingItem[]> = {};
  for (const it of items ?? []) {
    (byTeam[it.team_code] ??= []).push(it);
  }
  return byTeam;
}

/**
 * Resolver үүсгэнэ. Багийн код бүрд:
 *   1) үндсэн мөрүүдийн нэрийг тухайн төслийн override
 *      (sections['drawing-list'].fields[key].label)-оор солино,
 *   2) нийтлэг нэмэлт мөрүүдийг үргэлжилсэн дугаартайгаар залгана.
 */
export function makeDrawingRowsResolver(
  itemsByTeam: Record<string, TeamDrawingItem[]>,
  overridesByTeam: Record<string, TeamTemplateOverrides | null | undefined>,
): DrawingRowsResolver {
  return (teamCode, baseRows) => {
    const fieldOverrides = overridesByTeam[teamCode]?.sections?.['drawing-list']?.fields;
    const rows: DrawingRow[] = baseRows.map((r) => {
      const label = fieldOverrides?.[r.key]?.label;
      return label?.length ? { ...r, label: stripLeadingNo(label) } : { ...r };
    });
    const extras = itemsByTeam[teamCode] ?? [];
    extras.forEach((it, i) => {
      const label = fieldOverrides?.[it.key]?.label;
      rows.push({
        no: baseRows.length + i + 1,
        key: it.key,
        label: stripLeadingNo(label?.length ? label : it.label),
      });
    });
    return rows;
  };
}

/** Нэмэлт мөрүүдийг тухайн багийн 'drawing-list' хэсэгт checkbox талбар
 *  болгож залгана — AccordionForm автоматаар рендэрлэж, хариулт нь
 *  answers[key]=true болж хадгалагдана. */
export function appendDrawingItemsToSections<A>(
  sections: SectionDef<A>[],
  items: TeamDrawingItem[] | undefined,
): SectionDef<A>[] {
  if (!items || items.length === 0) return sections;
  return sections.map((section) => {
    if (section.id !== 'drawing-list') return section;
    const baseCount = section.fields.length;
    const extras = items.map(
      (it, i): FieldDef<A> => ({
        key: it.key as FieldDef<A>['key'],
        label: `${baseCount + i + 1}. ${stripLeadingNo(it.label)}`,
        kind: 'checkbox',
        span: 'full',
      }),
    );
    return { ...section, fields: [...section.fields, ...extras] };
  });
}
