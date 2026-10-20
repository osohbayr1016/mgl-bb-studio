import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Card, CardContent } from '@/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { Skeleton } from '@/ui/skeleton';
import { formatDateTime } from '@/shared/lib/time';

import { PivotTable } from '../PivotTable';
import { CategoryBarsView } from './CategoryBarsView';
import { CategoryCardGrid } from './CategoryCardGrid';
import { CategoryChips } from './CategoryChips';
import { DashboardHero } from './DashboardHero';
import { DashboardSummary } from './DashboardSummary';
import { DashboardToolbar, type DashSort, type DashView } from './DashboardToolbar';
import { FileChips } from './FileChips';
import { RoomsView } from './RoomsView';
import { SchedulesView } from './SchedulesView';
import { ViewExports } from './ViewExports';
import { categoryStyle } from '../../lib/categoryColors';
import { exportQtoXlsx, type TaggedFactRow } from '../../lib/exportXlsx';
import {
  detectDiscipline,
  DISCIPLINE_LABEL_KEY,
  DISCIPLINE_ORDER,
  type DisciplineCode,
} from '../../lib/discipline';
import { compareNodes, type PivotNode, type PivotSourceRow } from '../../lib/pivots';
import type { DashCategory, DashTypeRow, DashViewCard } from './CategoryCard';
import type {
  QtoDashboardFile,
  QtoDashboardResponse,
  QtoFactRow,
} from '../../lib/types';

/**
 * Самбар — «Element Dashboard»: төслийн ФАЙЛ бүрийн сүүлийн run-уудын нэгтгэл.
 * Backend run_id-аар түлхүүрлэсэн aggregate өгдөг тул бүх шүүлт client талд —
 * refetch алга. Шүүлтийн давхарга: файл chips → DATASET (hero, спектр, chip
 * тоо); категорийн chips → VIEW; хайлт → view доторх нарийсгал.
 *
 * Parent нь key={projectId}-ээр mount хийдэг тул төсөл солигдоход бүх локал
 * төлөв (excluded/selectedCats/query/…) автоматаар цэвэрлэгдэнэ.
 */
export function DashboardTab({
  projectId,
  allowed,
  isAdmin,
  projectLabel,
  onDrill,
}: {
  projectId: number;
  allowed: boolean;
  isAdmin: boolean;
  projectLabel: string;
  onDrill: (runId: number) => void;
}) {
  const { t } = useLanguage();
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DashSort>('count');
  const [view, setView] = useState<DashView>('summary');

  const dashQuery = useApiQuery<QtoDashboardResponse>(
    ['/qto/projects', projectId, 'dashboard'],
    `/qto/projects/${projectId}/dashboard`,
    { enabled: allowed },
  );
  const data = dashQuery.data;
  const files = useMemo(() => data?.files ?? [], [data]);

  const labelOf = useMemo(() => {
    const noFile = t('qtoPage.noFile');
    const byRun = new Map<number, string>();
    for (const f of files) {
      byRun.set(f.run_id, f.file_name ? f.file_name.replace(/\.[^.]+$/, '') : noFile);
    }
    return (f: QtoDashboardFile | number): string => {
      const id = typeof f === 'number' ? f : f.run_id;
      return byRun.get(id) ?? noFile;
    };
  }, [files, t]);

  // Chips-ийн салбарын бүлгүүд (тогтмол дараалалтай, хоосон бүлэг орхигдоно).
  const disciplineGroups = useMemo(() => {
    const byCode = new Map<DisciplineCode, QtoDashboardFile[]>();
    for (const f of files) {
      const code = detectDiscipline(f.file_name);
      const list = byCode.get(code);
      if (list) list.push(f);
      else byCode.set(code, [f]);
    }
    return DISCIPLINE_ORDER.filter((code) => byCode.has(code)).map((code) => ({
      label: t(DISCIPLINE_LABEL_KEY[code]),
      files: byCode.get(code)!,
    }));
  }, [files, t]);

  const includedFiles = useMemo(
    () => files.filter((f) => !excluded.has(f.run_id)),
    [files, excluded],
  );
  const includedIds = useMemo(
    () => new Set(includedFiles.map((f) => f.run_id)),
    [includedFiles],
  );

  const toggleFile = (runId: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const toggleCat = (key: string) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* ---- derivations --------------------------------------------------------
   * DATASET (файлын шүүлтийн дараах) → hero нийт, спектр, chip тоонууд.
   * Категорийн chips + хайлт зөвхөн VIEW-г (карт/баар/хүснэгт) шүүнэ. */

  // Категори run-уудын хооронд нэгтгэсэн канон жагсаалт — үргэлж count desc
  // (спектр/chips-ийн дараалал sort-оос хамаарахгүй).
  const categories = useMemo<DashCategory[]>(() => {
    type CatAcc = Omit<DashCategory, 'typeCount'> & {
      typeCount: number;
      typeCountKnown: boolean;
    };
    const map = new Map<string, CatAcc>();
    for (const r of data?.by_category ?? []) {
      if (!includedIds.has(r.run_id)) continue;
      const key = (r.category ?? '').trim();
      let agg = map.get(key);
      if (!agg) {
        const style = categoryStyle(key);
        agg = {
          key,
          label: key || t('qtoPage.noCategory'),
          count: 0,
          length_m: 0,
          area_m2: 0,
          volume_m3: 0,
          mass_kg: 0,
          typeCount: 0,
          typeCountKnown: true,
          color: style.color,
          Icon: style.Icon,
        };
        map.set(key, agg);
      }
      agg.count += r.count;
      agg.length_m += r.length_m;
      agg.area_m2 += r.area_m2;
      agg.volume_m3 += r.volume_m3;
      agg.mass_kg += r.mass_kg;
      // type_count нь run бүрийн distinct тоо — нэг төрөл 2 файлд давхардан
      // тоологдоно (хүлээн зөвшөөрөгдсөн ойролцоо утга). Аль нэг run-д талбар
      // байхгүй бол (хуучин edge-cache payload) нийт нь тодорхойгүй.
      if (r.type_count == null) agg.typeCountKnown = false;
      else agg.typeCount += r.type_count;
    }
    return [...map.values()]
      .map(({ typeCountKnown, ...c }) => ({
        ...c,
        typeCount: typeCountKnown ? c.typeCount : null,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [data, includedIds, t]);

  const totalCount = useMemo(
    () => categories.reduce((s, c) => s + c.count, 0),
    [categories],
  );

  const hasTypeRows = (data?.by_type ?? []).length > 0;

  // (category, family, type) түвшний нэгтгэл — категори тус бүрийн sorted
  // жагсаалт. Sort нь зөвхөн төрлийн доторх дарааллыг сольдог.
  const typesByCat = useMemo(() => {
    const byCat = new Map<string, Map<string, DashTypeRow>>();
    for (const r of data?.by_type ?? []) {
      if (!includedIds.has(r.run_id)) continue;
      const cat = (r.category ?? '').trim();
      const family = (r.family ?? '').trim();
      const typeName = (r.type_name ?? '').trim();
      let inner = byCat.get(cat);
      if (!inner) {
        inner = new Map();
        byCat.set(cat, inner);
      }
      const tkey = `${family} ${typeName}`;
      let agg = inner.get(tkey);
      if (!agg) {
        agg = {
          family,
          type_name: typeName,
          count: 0,
          length_m: 0,
          area_m2: 0,
          volume_m3: 0,
          mass_kg: 0,
          type_mark: null,
        };
        inner.set(tkey, agg);
      }
      agg.count += r.count;
      agg.length_m += r.length_m;
      agg.area_m2 += r.area_m2;
      agg.volume_m3 += r.volume_m3;
      agg.mass_kg += r.mass_kg;
      // Марк type-түвшний тул run-уудын хооронд ижил — эхний хоосон биш нь ялна.
      if (agg.type_mark == null && r.type_mark) agg.type_mark = r.type_mark;
    }
    const cmp = (a: DashTypeRow, b: DashTypeRow): number => {
      if (sort === 'family') {
        return (
          a.family.localeCompare(b.family) ||
          a.type_name.localeCompare(b.type_name) ||
          b.count - a.count
        );
      }
      if (sort === 'type') {
        return (
          a.type_name.localeCompare(b.type_name) ||
          a.family.localeCompare(b.family) ||
          b.count - a.count
        );
      }
      return (
        b.count - a.count ||
        a.family.localeCompare(b.family) ||
        a.type_name.localeCompare(b.type_name)
      );
    };
    const result = new Map<string, DashTypeRow[]>();
    for (const [cat, inner] of byCat) result.set(cat, [...inner.values()].sort(cmp));
    return result;
  }, [data, includedIds, sort]);

  // VIEW-картууд: chips → категори, хайлт → категори ЭСВЭЛ төрөл дээр тааруулна.
  // Зөвхөн төрөл таарсан үед тухайн картад таарсан төрлүүд л үлдэнэ.
  const viewCards = useMemo<DashViewCard[]>(() => {
    const q = query.trim().toLowerCase();
    const chipActive = selectedCats.size > 0;
    const ordered =
      sort === 'category'
        ? [...categories].sort((a, b) => a.label.localeCompare(b.label))
        : categories;
    const cards: DashViewCard[] = [];
    for (const cat of ordered) {
      if (chipActive && !selectedCats.has(cat.key)) continue;
      const types = typesByCat.get(cat.key) ?? [];
      if (q === '' || cat.label.toLowerCase().includes(q)) {
        cards.push({ cat, types, narrowed: false });
        continue;
      }
      const matching = types.filter(
        (tp) => tp.family.toLowerCase().includes(q) || tp.type_name.toLowerCase().includes(q),
      );
      if (matching.length > 0) cards.push({ cat, types: matching, narrowed: true });
    }
    return cards;
  }, [categories, typesByCat, selectedCats, query, sort]);

  // Hero caption: шүүсэн VIEW доторх distinct төрөл + ширхэг. by_type байхгүй
  // (deploy-ийн дараах ≤60с stale edge-cache) үед type_count нийлбэрээр fallback,
  // тэр ч байхгүй бол caption-оо нуана.
  const caption = useMemo<{ types: number; instances: number } | null>(() => {
    if (hasTypeRows) {
      let types = 0;
      let instances = 0;
      for (const c of viewCards) {
        types += c.types.length;
        // Нарийсаагүй карт категорийн бүрэн тоогоо (4k cap-д хамаарахгүй) авна.
        instances += c.narrowed
          ? c.types.reduce((s, tp) => s + tp.count, 0)
          : c.cat.count;
      }
      return { types, instances };
    }
    if (query.trim() !== '' || selectedCats.size > 0) return null;
    let types = 0;
    let known = false;
    for (const c of categories) {
      if (c.typeCount != null) {
        types += c.typeCount;
        known = true;
      }
    }
    return known ? { types, instances: totalCount } : null;
  }, [hasTypeRows, viewCards, query, selectedCats, categories, totalCount]);

  // Table горим: view-шүүсэн төрлийн мөрүүд → PivotSourceRow.
  const tableRows = useMemo<PivotSourceRow[]>(
    () =>
      viewCards.flatMap((c) =>
        c.types.map((tp) => ({
          category: c.cat.key,
          family: tp.family,
          type_name: tp.type_name,
          count: tp.count,
          length_m: tp.length_m,
          area_m2: tp.area_m2,
          volume_m3: tp.volume_m3,
          mass_kg: tp.mass_kg,
        })),
      ),
    [viewCards],
  );

  // Өрөөний ведомость (0120) — included файлуудынх; хуучин payload-д байхгүй.
  const rooms = useMemo(
    () => (data?.by_room ?? []).filter((r) => includedIds.has(r.run_id)),
    [data, includedIds],
  );

  // Table горимын depth-aware эрэмбэ: сонгосон түвшинд alpha, бусад нь default.
  const tableComparator = useMemo(() => {
    const alphaDepth = sort === 'category' ? 0 : sort === 'family' ? 1 : sort === 'type' ? 2 : null;
    if (alphaDepth == null) return undefined;
    return (a: PivotNode, b: PivotNode, depth: number): number =>
      depth === alphaDepth
        ? a.value.localeCompare(b.value) || compareNodes(a, b)
        : compareNodes(a, b);
  }, [sort]);

  // Multi-file Excel: included файл бүрийн facts-ыг ДАРААЛЖ татна (нэг зэрэг
  // 12 хүсэлт биш — memory + сервер ачаалал), файлын шошго наагаад нэг
  // workbook болгоно.
  const handleExport = async () => {
    if (exportProgress != null || includedFiles.length === 0) return;
    try {
      const tagged: TaggedFactRow[] = [];
      for (let i = 0; i < includedFiles.length; i++) {
        const f = includedFiles[i]!;
        setExportProgress(`${i + 1}/${includedFiles.length}`);
        const { facts } = await apiFetch<{ facts: QtoFactRow[] }>(
          `/qto/runs/${f.run_id}/facts`,
        );
        const label = labelOf(f);
        for (const fact of facts) tagged.push({ ...fact, file: label });
      }

      const totals = includedFiles.reduce(
        (acc, f) => ({
          count: acc.count + (f.totals.count ?? 0),
          length_m: (acc.length_m ?? 0) + (f.totals.length_m ?? 0),
          area_m2: (acc.area_m2 ?? 0) + (f.totals.area_m2 ?? 0),
          volume_m3: (acc.volume_m3 ?? 0) + (f.totals.volume_m3 ?? 0),
          mass_kg: (acc.mass_kg ?? 0) + (f.totals.mass_kg ?? 0),
        }),
        { count: 0, length_m: 0, area_m2: 0, volume_m3: 0, mass_kg: 0 },
      );

      await exportQtoXlsx({
        fileName: `qto_dashboard_${projectLabel.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.xlsx`,
        multiFile: true,
        files: includedFiles.map((f) => ({
          name: f.file_name ?? t('qtoPage.noFile'),
          date: formatDateTime(f.created_at),
          elements: f.element_count,
        })),
        meta: {
          project: projectLabel,
          file: `${includedFiles.length} ${t('qtoPage.dashFilesCount')}`,
          date: formatDateTime(new Date().toISOString()),
          by: '',
          revitVersion: '',
        },
        totals,
        facts: tagged,
        rooms: rooms.map((r) => ({
          number: r.number,
          name: r.name,
          level: r.level,
          area_m2: r.area_m2,
        })),
        labels: {
          sheetOverview: t('qtoPage.sheetOverview'),
          sheetCategory: t('qtoPage.sheetCategory'),
          sheetMaterial: t('qtoPage.sheetMaterial'),
          sheetLevel: t('qtoPage.sheetLevel'),
          sheetFiles: t('qtoPage.sheetFiles'),
          colFile: t('qtoPage.colFile'),
          elements: t('qtoPage.totalElements'),
          colMark: t('qtoPage.colMark'),
          colMarks: t('qtoPage.colMarks'),
          colThickness: t('qtoPage.colThickness'),
          colKeynote: t('qtoPage.colKeynote'),
          sheetRooms: t('qtoPage.sheetRooms'),
          roomNumber: t('qtoPage.roomNumber'),
          roomName: t('qtoPage.roomName'),
          project: t('qtoPage.project'),
          file: t('qtoPage.runFile'),
          date: t('qtoPage.runDate'),
          by: t('qtoPage.runBy'),
          revitVersion: t('qtoPage.revitVersion'),
          category: t('qtoPage.colCategory'),
          family: t('qtoPage.colFamily'),
          type: t('qtoPage.colType'),
          level: t('qtoPage.colLevel'),
          material: t('qtoPage.colMaterial'),
          count: t('qtoPage.colCount'),
          length: t('qtoPage.colLength'),
          area: t('qtoPage.colArea'),
          volume: t('qtoPage.colVolume'),
          mass: t('qtoPage.colMass'),
          total: t('qtoPage.total'),
          noCategory: t('qtoPage.noCategory'),
          noFamily: t('qtoPage.noFamily'),
          noType: t('qtoPage.noType'),
          noLevel: t('qtoPage.noLevel'),
          noMaterial: t('qtoPage.noMaterial'),
        },
      });
    } catch {
      toast.error(t('qtoPage.exportFailed'));
    } finally {
      setExportProgress(null);
    }
  };

  /* ---- render ------------------------------------------------------------- */

  if (dashQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-9" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (dashQuery.isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-danger">
          {t('qtoPage.dashLoadFailed')}
        </CardContent>
      </Card>
    );
  }

  if (files.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          {t('qtoPage.dashEmpty')}
        </CardContent>
      </Card>
    );
  }

  const noResults =
    view !== 'rooms' &&
    view !== 'schedules' &&
    (viewCards.length === 0 || (view === 'table' && tableRows.length === 0));

  return (
    <div className="space-y-4">
      <DashboardHero
        projectLabel={projectLabel}
        fileCount={includedFiles.length}
        total={totalCount}
        segments={categories}
        selected={selectedCats}
        caption={caption}
      />

      <CategoryChips
        categories={categories}
        selected={selectedCats}
        onToggle={toggleCat}
        onClear={() => setSelectedCats(new Set())}
      />

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1.5 font-mono text-label text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
          {t('qtoPage.dashFilesToggle')} · {includedFiles.length}/{files.length}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <FileChips
            groups={disciplineGroups}
            excluded={excluded}
            onToggle={toggleFile}
            onDrill={onDrill}
            labelOf={labelOf}
          />
        </CollapsibleContent>
      </Collapsible>

      <DashboardSummary files={includedFiles} />

      <DashboardToolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        view={view}
        onView={setView}
        onExport={() => void handleExport()}
        exportProgress={exportProgress}
        exportDisabled={includedFiles.length === 0}
      />

      {data?.truncated && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          {t('qtoPage.dashTruncated')}
        </p>
      )}

      {(data?.by_type_truncated ?? false) && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          {t('qtoPage.dashTypeTruncated')}
        </p>
      )}

      {noResults ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('qtoPage.dashNoResults')}
          </CardContent>
        </Card>
      ) : view === 'schedules' ? (
        <SchedulesView
          projectId={projectId}
          allowed={allowed}
          isAdmin={isAdmin}
          query={query}
        />
      ) : view === 'rooms' ? (
        <RoomsView rooms={rooms} query={query} truncated={!!data?.rooms_truncated} />
      ) : view === 'summary' ? (
        <CategoryCardGrid cards={viewCards} />
      ) : view === 'bars' ? (
        <CategoryBarsView cards={viewCards} />
      ) : (
        <Card className="py-4">
          <CardContent className="px-4">
            <PivotTable
              facts={tableRows}
              fields={['category', 'family', 'type_name']}
              withBars
              comparator={tableComparator}
            />
          </CardContent>
        </Card>
      )}

      <ViewExports projectId={projectId} allowed={allowed} isAdmin={isAdmin} />
    </div>
  );
}
