/* ==========================================================================
   CopyStructureSheet — «Бүтэц татах»
   ==========================================================================

   Засварын гэрээ (ангилал `ZA`) ирэхэд админ ижил барилгын блок → зураг →
   эд анги → ажлын модыг ТЭГЭЭС дахин барьдаг байв.  Энэ хуудас түүнийг
   хуулна.

   ЭЗНИЙ ШИЙДВЭР — ЭНД ЗӨРЧИГДӨЖ БОЛОХГҮЙ:

   1. ЖИНГ ҮГЧЛЭН хуулна.  Хэвийшүүлэхгүй, дахин хуваарилахгүй, «засахгүй».
      7 мэргэжлээс 2-ыг нь сонговол шинэ төслийн багийн хувь нийлбэр 41
      болж, төсөл ХЭЗЭЭ Ч 41%-иас дээш гарахгүй.  Энэ нь зөв — ГЭХДЭЭ тэр
      таазыг доорх толгойд ТОМООР, 99.5-аас доош бол УЛААНААР харуулна.
      Тоог чимээгүй засах нь энэ хуудсан дээрх хамгийн том алдаа болно.
      ⚠️ ЭНЭ НӨХЦӨЛ НЬ «ХАРУУЛСАН ТОО = БИЧИГДЭХ ТОО» ГЭСЭН УТГАТАЙ:
      дэлгэц дээрх тааз ХУУЧИРСАН (debounce хүлээж буй, хүсэлт нисэж
      буй, эсвэл `placeholderData` өмнөх хариуг барьж буй) үед «Хуулах»
      ХОРИГЛОГДОНО, тоонууд «—» болно (`planPending`).  Мөн бодит
      хуулбар нь амьд сонголтыг БИШ, ТААЗ БОДОГДСОН (debounce хийгдсэн)
      сонголтыг илгээнэ — `useCopyStructure.commit`-ыг үз.
   2. Сонголт нь МЭРГЭЖЛЭЭР эхэлнэ (багийн чипүүд).  Блок/зураг/ажлын
      нарийн сонголт нь «Дэлгэрэнгүй сонголт» дэлгэгчийн ДОТОР, хаалттай.
   3. Гүйцэтгэгч ба огноог ХЭЗЭЭ Ч хуулахгүй (серверийн шийдвэр — энд
      сонголт ч байхгүй).

   ⚠️ ЖИНГИЙН ТООЦОО ЭНД БАЙХГҮЙ.  Тоо ширхэг ба ДЭЭД ХЯЗГААР нь
   `dry_run: true` хүсэлтээр серверээс ирнэ (`useCopyStructure`).  Энэ
   кодбааз дахь нэгтгэлийн томьёо аль хэдийн 11 газар хуулагдсан — 12
   дахийг нь БҮҮ нэм.

   ⚠️ 1051 ажилтай төсөл бий.  Мод нь ХААЛТТАЙ эхэлж, түвшнийг нээх үед
   Л хүүхдүүдээ mount хийнэ (`{expanded && …}`) — эс тэгвээс дэлгэц нээхэд
   мянган мөр зэрэг үүснэ.
   ========================================================================== */
import { useCallback, useMemo, useState, type JSX } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';

import { ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { Team } from '@/shared/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet';

import { TEAM_NAME_BY_CODE } from '../teamMeta';
import { SourceProjectPicker } from './SourceProjectPicker';
import { useCopyStructure } from './useCopyStructure';
import {
  emptyDeselection,
  type CopySelectionInput,
  type CopySourceTreeResponse,
  type DeselectedIds,
  type TriState,
} from './types';

/** Үүнээс доош дээд хязгаар нь УЛААН.  100 биш 99.5 — хөвөгч цэгийн
 *  нийлбэр (33.33 × 3) хэзээ ч яг 100 болдоггүй. */
const CEILING_OK_MIN = 99.5;

/** Тогтвортой хоосон утгууд — эх төсөл солигдсон агшинд `useMemo`-ийн
 *  хамаарал шинэ объектоор дүүрч, урьдчилсан харалт дэмий давтагдахаас
 *  сэргийлнэ. */
const EMPTY_DESELECTION: DeselectedIds = emptyDeselection();
const EMPTY_KEYS: Set<string> = new Set<string>();

/* ============================================================
 *  Эх модны индекс
 * ============================================================ */

interface TaskNode {
  id: number;
  name: string;
  weight: number;
}
interface CompNode {
  id: number;
  name: string;
  weight: number;
  tasks: TaskNode[];
  taskIds: number[];
}
interface DrawNode {
  id: number;
  name: string;
  weight: number;
  components: CompNode[];
  taskIds: number[];
}
interface BlockNode {
  id: number;
  name: string;
  weight: number;
  teamId: number | null;
  drawings: DrawNode[];
  taskIds: number[];
}
interface TeamGroup {
  /** `null` = багт хамааралгүй блокуудын бүлэг (`blocks.team_id IS NULL`). */
  teamId: number | null;
  code: string;
  name: string;
  /** `project_team_shares`-д мөр байхгүй бол `null`. */
  share: number | null;
  blocks: BlockNode[];
  taskIds: number[];
}
interface TreeIndex {
  groups: TeamGroup[];
  allTeamIds: number[];
  allBlockIds: number[];
  allDrawingIds: number[];
  allComponentIds: number[];
  allTaskIds: number[];
}

function buildIndex(
  data: CopySourceTreeResponse | undefined,
  teams: Team[] | undefined,
): TreeIndex | null {
  if (!data) return null;
  const teamById = new Map<number, Team>((teams ?? []).map((tm) => [tm.id, tm]));

  const allBlockIds: number[] = [];
  const allDrawingIds: number[] = [];
  const allComponentIds: number[] = [];
  const allTaskIds: number[] = [];

  const blockNodes: BlockNode[] = (data.blocks ?? []).map((b) => {
    const drawings: DrawNode[] = (b.drawings ?? []).map((d) => {
      const components: CompNode[] = (d.components ?? []).map((c) => {
        const tasks: TaskNode[] = (c.tasks ?? []).map((tk) => ({
          id: tk.id,
          name: tk.name,
          weight: Number(tk.weight_percent) || 0,
        }));
        const taskIds = tasks.map((tk) => tk.id);
        allComponentIds.push(c.id);
        allTaskIds.push(...taskIds);
        return {
          id: c.id,
          name: c.name,
          weight: Number(c.weight_percent) || 0,
          tasks,
          taskIds,
        };
      });
      const taskIds = components.flatMap((c) => c.taskIds);
      allDrawingIds.push(d.id);
      return {
        id: d.id,
        name: d.name,
        weight: Number(d.weight_percent) || 0,
        components,
        taskIds,
      };
    });
    const taskIds = drawings.flatMap((d) => d.taskIds);
    allBlockIds.push(b.id);
    return {
      id: b.id,
      name: b.name,
      weight: Number(b.weight_percent) || 0,
      teamId: b.team_id ?? null,
      drawings,
      taskIds,
    };
  });

  /* Багийн бүлгүүд = `project_team_shares` ∪ блокуудын `team_id`.
   * (Серверийн `team_keys` CTE-ийн санааг давтав: хувьгүй ч блоктой баг
   * жагсаалтаас унах ёсгүй, эсрэгээрээ ч мөн адил.) */
  const groupMap = new Map<number, TeamGroup>();
  const order: number[] = [];
  for (const s of data.team_shares ?? []) {
    if (groupMap.has(s.team_id)) continue;
    groupMap.set(s.team_id, {
      teamId: s.team_id,
      code: s.team_code,
      name: s.team_name_mn || TEAM_NAME_BY_CODE[s.team_code] || s.team_code,
      share: Number(s.share_percent) || 0,
      blocks: [],
      taskIds: [],
    });
    order.push(s.team_id);
  }
  for (const b of blockNodes) {
    if (b.teamId == null || groupMap.has(b.teamId)) continue;
    const tm = teamById.get(b.teamId);
    const code = tm?.code ?? String(b.teamId);
    groupMap.set(b.teamId, {
      teamId: b.teamId,
      code,
      name: tm?.name_mn || TEAM_NAME_BY_CODE[code] || code,
      share: null,
      blocks: [],
      taskIds: [],
    });
    order.push(b.teamId);
  }

  const noTeam: TeamGroup = {
    teamId: null,
    code: '—',
    name: '—',
    share: null,
    blocks: [],
    taskIds: [],
  };
  for (const b of blockNodes) {
    const g = b.teamId == null ? noTeam : groupMap.get(b.teamId);
    if (!g) continue;
    g.blocks.push(b);
    g.taskIds.push(...b.taskIds);
  }

  const groups = order.map((id) => groupMap.get(id)).filter((g): g is TeamGroup => g !== undefined);
  if (noTeam.blocks.length > 0) groups.push(noTeam);

  return {
    groups,
    allTeamIds: order,
    allBlockIds,
    allDrawingIds,
    allComponentIds,
    allTaskIds,
  };
}

/* ============================================================
 *  Сонголтын үйлдлүүд
 * ============================================================
 *  Загвар: «урьдчилан унжуулсан сөрөг жагсаалт».  Мөчийг унтраахад
 *  түүний БҮХ удам мөн ил бичигдэнэ; асаахад өвөг дээдсийг нь чөлөөлнө
 *  (тэдгээрийн бусад хүүхэд аль хэдийн ил бичигдсэн тул санамсаргүйгээр
 *  дагаж сэргэхгүй).  Ингэснээр «мөч олонлогт байвал бүх удам нь бас
 *  байна» гэсэн тогтмол хадгалагдаж, «сонгогдсон эсэх» шалгахад өвөг
 *  дээдсийг гүйлгэх шаардлагагүй болно. */

interface TogglePath {
  group: TeamGroup;
  block?: BlockNode;
  drawing?: DrawNode;
  component?: CompNode;
  task?: TaskNode;
}

function cloneDes(d: DeselectedIds): DeselectedIds {
  return {
    teams: new Set(d.teams),
    blocks: new Set(d.blocks),
    drawings: new Set(d.drawings),
    components: new Set(d.components),
    tasks: new Set(d.tasks),
  };
}

/** Хамгийн ГҮН заасан мөч + түүний бүх удмын id-ууд. */
function subtreeIds(path: TogglePath): {
  blocks: number[];
  drawings: number[];
  components: number[];
  tasks: number[];
} {
  const { group, block, drawing, component, task } = path;
  if (task) return { blocks: [], drawings: [], components: [], tasks: [task.id] };
  if (component) {
    return { blocks: [], drawings: [], components: [component.id], tasks: component.taskIds };
  }
  if (drawing) {
    return {
      blocks: [],
      drawings: [drawing.id],
      components: drawing.components.map((c) => c.id),
      tasks: drawing.taskIds,
    };
  }
  const blocks = block ? [block] : group.blocks;
  return {
    blocks: blocks.map((b) => b.id),
    drawings: blocks.flatMap((b) => b.drawings.map((d) => d.id)),
    components: blocks.flatMap((b) => b.drawings.flatMap((d) => d.components.map((c) => c.id))),
    tasks: blocks.flatMap((b) => b.taskIds),
  };
}

function applyToggle(des: DeselectedIds, path: TogglePath, next: boolean): DeselectedIds {
  const d = cloneDes(des);
  const { group, block, drawing, component, task } = path;
  const scope = subtreeIds(path);

  if (next) {
    // 1) Өвөг дээдсийг (болон өөрийг нь) чөлөөлнө.
    if (group.teamId != null) d.teams.delete(group.teamId);
    if (block) d.blocks.delete(block.id);
    if (drawing) d.drawings.delete(drawing.id);
    if (component) d.components.delete(component.id);
    if (task) d.tasks.delete(task.id);
    // 2) Бүх удмыг сэргээнэ.
    for (const id of scope.blocks) d.blocks.delete(id);
    for (const id of scope.drawings) d.drawings.delete(id);
    for (const id of scope.components) d.components.delete(id);
    for (const id of scope.tasks) d.tasks.delete(id);
  } else {
    const isTeamLevel = !block && !drawing && !component && !task;
    if (isTeamLevel && group.teamId != null) d.teams.add(group.teamId);
    for (const id of scope.blocks) d.blocks.add(id);
    for (const id of scope.drawings) d.drawings.add(id);
    for (const id of scope.components) d.components.add(id);
    for (const id of scope.tasks) d.tasks.add(id);
  }
  return d;
}

function selectedCount(taskIds: number[], des: DeselectedIds): number {
  let n = 0;
  for (const id of taskIds) if (!des.tasks.has(id)) n += 1;
  return n;
}

/** Эцэг мөчийн гурван төлөв.  Ажилгүй мөч (`total === 0`) нь зөвхөн
 *  ӨӨРИЙН тугаараа шийдэгдэнэ. */
function triState(selfDeselected: boolean, sel: number, total: number): TriState {
  if (total === 0) return !selfDeselected;
  if (sel === 0) return false;
  if (sel === total && !selfDeselected) return true;
  return 'indeterminate';
}

/* ============================================================
 *  Алдааны код → орчуулгын түлхүүр
 * ============================================================
 *  Серверийн түүхий (англи) мессежийг ХЭЗЭЭ Ч гаргахгүй. */
function errorKey(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  switch (code) {
    case 'SAME_PROJECT':
      return 'copyStructure.errorSame';
    case 'CYCLE':
      return 'copyStructure.errorCycle';
    case 'TOO_LARGE':
      return 'copyStructure.errorTooLarge';
    case 'NO_SELECTION':
      return 'copyStructure.errorNoSelection';
    case 'ALREADY_LINKED':
      // Шинэ утга: «энэ төсөлд ӨӨР эх төслөөс татсан бүтэц аль хэдийн бий».
      // (Үүсгэх цонхны урьдчилсан холбоос нь өөрөө 409 өгөхөө больсон.)
      return 'copyStructure.errorAlreadyLinked';
    case 'HAS_PROGRESS':
      return 'copyStructure.errorHasProgress';
    case 'PARTIAL':
      return 'copyStructure.errorPartial';
    default:
      return 'common.actionFailed';
  }
}

/* ============================================================
 *  Модны мөрүүд
 * ============================================================ */

interface TreeCtx {
  des: DeselectedIds;
  onToggle: (path: TogglePath, next: boolean) => void;
  expanded: Set<string>;
  onExpand: (key: string, open: boolean) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** Нэг эгнээ: [чевron] [checkbox] нэр … жин · тоо. */
function Row({
  depth,
  expandable,
  open,
  onOpen,
  state,
  onCheck,
  label,
  weight,
  meta,
}: {
  depth: number;
  expandable: boolean;
  open: boolean;
  onOpen: () => void;
  state: TriState;
  onCheck: (next: boolean) => void;
  label: string;
  weight?: number;
  meta?: string;
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 rounded-md py-1 pr-2 hover:bg-accent/40"
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex size-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          aria-label={label}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      ) : (
        <span className="size-5 flex-shrink-0" />
      )}
      <Checkbox
        checked={state}
        onCheckedChange={(v) => onCheck(v === true)}
        aria-label={label}
        className="flex-shrink-0"
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          state === false && 'text-muted-foreground line-through',
        )}
        title={label}
      >
        {label}
      </span>
      {weight !== undefined && (
        <span className="flex-shrink-0 text-micro tabular-nums text-muted-foreground">
          {weight.toFixed(weight % 1 === 0 ? 0 : 1)}%
        </span>
      )}
      {meta && (
        <span className="flex-shrink-0 text-micro tabular-nums text-muted-foreground">{meta}</span>
      )}
    </div>
  );
}

function ComponentRows({
  ctx,
  group,
  block,
  drawing,
  component,
}: {
  ctx: TreeCtx;
  group: TeamGroup;
  block: BlockNode;
  drawing: DrawNode;
  component: CompNode;
}): JSX.Element {
  const key = `C${component.id}`;
  const open = ctx.expanded.has(key);
  const sel = selectedCount(component.taskIds, ctx.des);
  const state = triState(ctx.des.components.has(component.id), sel, component.taskIds.length);
  return (
    <>
      <Row
        depth={3}
        expandable={component.tasks.length > 0}
        open={open}
        onOpen={() => ctx.onExpand(key, !open)}
        state={state}
        onCheck={(next) => ctx.onToggle({ group, block, drawing, component }, next)}
        label={component.name}
        weight={component.weight}
        meta={`${sel}/${component.tasks.length} ${ctx.t('copyStructure.tasksUnit')}`}
      />
      {/* Ажлын мөрүүд нээх хүртэл mount ХИЙГДЭХГҮЙ. */}
      {open &&
        component.tasks.map((task) => {
          const taskState = !ctx.des.tasks.has(task.id);
          return (
            <Row
              key={task.id}
              depth={4}
              expandable={false}
              open={false}
              onOpen={() => {}}
              state={taskState}
              onCheck={(next) => ctx.onToggle({ group, block, drawing, component, task }, next)}
              label={task.name}
              weight={task.weight}
            />
          );
        })}
    </>
  );
}

function DrawingRows({
  ctx,
  group,
  block,
  drawing,
}: {
  ctx: TreeCtx;
  group: TeamGroup;
  block: BlockNode;
  drawing: DrawNode;
}): JSX.Element {
  const key = `D${drawing.id}`;
  const open = ctx.expanded.has(key);
  const sel = selectedCount(drawing.taskIds, ctx.des);
  const state = triState(ctx.des.drawings.has(drawing.id), sel, drawing.taskIds.length);
  return (
    <>
      <Row
        depth={2}
        expandable={drawing.components.length > 0}
        open={open}
        onOpen={() => ctx.onExpand(key, !open)}
        state={state}
        onCheck={(next) => ctx.onToggle({ group, block, drawing }, next)}
        label={drawing.name}
        weight={drawing.weight}
        meta={`${sel}/${drawing.taskIds.length} ${ctx.t('copyStructure.tasksUnit')}`}
      />
      {open &&
        drawing.components.map((component) => (
          <ComponentRows
            key={component.id}
            ctx={ctx}
            group={group}
            block={block}
            drawing={drawing}
            component={component}
          />
        ))}
    </>
  );
}

function BlockRows({
  ctx,
  group,
  block,
}: {
  ctx: TreeCtx;
  group: TeamGroup;
  block: BlockNode;
}): JSX.Element {
  const key = `B${block.id}`;
  const open = ctx.expanded.has(key);
  const sel = selectedCount(block.taskIds, ctx.des);
  const state = triState(ctx.des.blocks.has(block.id), sel, block.taskIds.length);
  return (
    <>
      <Row
        depth={1}
        expandable={block.drawings.length > 0}
        open={open}
        onOpen={() => ctx.onExpand(key, !open)}
        state={state}
        onCheck={(next) => ctx.onToggle({ group, block }, next)}
        label={block.name}
        weight={block.weight}
        meta={`${block.drawings.length} ${ctx.t('copyStructure.drawingsUnit')} · ${sel}/${block.taskIds.length} ${ctx.t('copyStructure.tasksUnit')}`}
      />
      {open &&
        block.drawings.map((drawing) => (
          <DrawingRows key={drawing.id} ctx={ctx} group={group} block={block} drawing={drawing} />
        ))}
    </>
  );
}

function GroupRows({ ctx, group }: { ctx: TreeCtx; group: TeamGroup }): JSX.Element {
  const key = `T${group.teamId ?? 'none'}`;
  const open = ctx.expanded.has(key);
  const sel = selectedCount(group.taskIds, ctx.des);
  const selfDes = group.teamId != null && ctx.des.teams.has(group.teamId);
  const state = triState(selfDes, sel, group.taskIds.length);
  return (
    <>
      <Row
        depth={0}
        expandable={group.blocks.length > 0}
        open={open}
        onOpen={() => ctx.onExpand(key, !open)}
        state={state}
        onCheck={(next) => ctx.onToggle({ group }, next)}
        label={group.teamId == null ? group.name : `${group.code} · ${group.name}`}
        {...(group.share !== null ? { weight: group.share } : {})}
        meta={`${group.blocks.length} ${ctx.t('copyStructure.blocksUnit')} · ${sel}/${group.taskIds.length} ${ctx.t('copyStructure.tasksUnit')}`}
      />
      {open &&
        group.blocks.map((block) => (
          <BlockRows key={block.id} ctx={ctx} group={group} block={block} />
        ))}
    </>
  );
}

/* ============================================================
 *  Үндсэн компонент
 * ============================================================ */

export interface CopyStructureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetProjectId: number;
  targetProjectName?: string;
  targetShifr?: string | null;
  initialSourceId?: number | null;
  hasExistingStructure?: boolean;
  /** Дуудагч ӨӨРӨӨ модоо дахин уншина — энэ хуудас түүнийг мэдэхгүй. */
  onCopied: () => void;
}

/** Гаднах бүрхүүл.  Бүх ТӨЛӨВ нь `CopyStructureBody`-д амьдардаг бөгөөд
 *  Radix нь хаагдахад `SheetContent`-ийг unmount хийдэг тул дэлгэц дахин
 *  нээгдэхэд сонголт, алдаа, амжилтын мэдэгдэл БҮГД цэвэр эхэлнэ.  Урьд нь
 *  үүнийг `useEffect`-ээр «гараар» цэвэрлэдэг байсан — тэр загварт нэг
 *  салбар мартагдвал өмнөх төслийн сонголт шинэ төсөл дээр чимээгүй үлдэх
 *  эрсдэл үргэлж үлддэг. */
export function CopyStructureSheet(props: CopyStructureSheetProps): JSX.Element {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-3xl"
      >
        <CopyStructureBody {...props} />
      </SheetContent>
    </Sheet>
  );
}

function CopyStructureBody({
  onOpenChange,
  targetProjectId,
  targetProjectName,
  targetShifr,
  initialSourceId,
  hasExistingStructure,
  onCopied,
}: CopyStructureSheetProps): JSX.Element {
  const { t } = useLanguage();

  const [sourceId, setSourceId] = useState<number | null>(initialSourceId ?? null);
  /* ⚠️ Сонголтыг ЭХ ТӨСЛИЙН id-тай хамт хадгална.  Эх төсөл солигдоход
   * хуучин модны id-ууд руу заасан сонголт үлдвэл сервер огт өөр мөрүүдийг
   * хуулна.  `useEffect`-ээр цэвэрлэхийн оронд УНШИХ үедээ шүүх нь тэр
   * зөрүүг бүтцээрээ боломжгүй болгоно. */
  const [desState, setDesState] = useState<{ srcId: number | null; des: DeselectedIds }>(() => ({
    srcId: initialSourceId ?? null,
    des: emptyDeselection(),
  }));
  const [expState, setExpState] = useState<{ srcId: number | null; keys: Set<string> }>(() => ({
    srcId: initialSourceId ?? null,
    keys: new Set<string>(),
  }));
  const [advanced, setAdvanced] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errText, setErrText] = useState<string | null>(null);
  const [doneCounts, setDoneCounts] = useState<{ blocks: number; tasks: number } | null>(null);

  const des = desState.srcId === sourceId ? desState.des : EMPTY_DESELECTION;
  const expanded = expState.srcId === sourceId ? expState.keys : EMPTY_KEYS;

  /* Эх төслийн БҮТЭН мод — НЭГ дуудлага (`GET /api/projects/:id` нь блок →
   * зураг → эд анги → ажлыг бүхэлд нь буцаадаг).  Түвшин тус бүрээр
   * татахыг ХОРИГЛОНО. */
  const treeQuery = useApiQuery<CopySourceTreeResponse>(`/projects/${sourceId ?? 0}`, {
    enabled: sourceId != null,
    staleTime: 60_000,
  });
  const teamsQuery = useApiQuery<{ teams: Team[] }>('/teams', {
    staleTime: 5 * 60_000,
  });

  const index = useMemo(
    () => buildIndex(sourceId != null ? treeQuery.data : undefined, teamsQuery.data?.teams),
    [sourceId, treeQuery.data, teamsQuery.data],
  );

  const selection = useMemo<CopySelectionInput>(() => {
    const empty: CopySelectionInput = {
      team_ids: null,
      block_ids: null,
      drawing_ids: null,
      component_ids: null,
      task_ids: null,
    };
    if (!index) return empty;
    const teamsTouched = des.teams.size > 0;
    const blocksTouched = des.blocks.size > 0;
    return {
      team_ids: teamsTouched ? index.allTeamIds.filter((id) => !des.teams.has(id)) : null,
      // Баг унтраасан үед блокуудыг ч ИЛ жагсаана: багт хамааралгүй
      // (`team_id IS NULL`) блокуудыг «баг сонгогдоогүй» гэж алдаж
      // хасахгүйн тулд сонголтыг хоёр талаас нь тодорхой болгоно.
      block_ids:
        teamsTouched || blocksTouched
          ? index.allBlockIds.filter((id) => !des.blocks.has(id))
          : null,
      drawing_ids:
        des.drawings.size > 0 ? index.allDrawingIds.filter((id) => !des.drawings.has(id)) : null,
      component_ids:
        des.components.size > 0
          ? index.allComponentIds.filter((id) => !des.components.has(id))
          : null,
      task_ids: des.tasks.size > 0 ? index.allTaskIds.filter((id) => !des.tasks.has(id)) : null,
    };
  }, [index, des]);

  const { preview, previewStale, previewError, commit, committing } = useCopyStructure({
    targetProjectId,
    sourceProjectId: sourceId,
    selection,
    enabled: index !== null && doneCounts === null,
  });

  /** Сонголтыг солих цорын ганц гарц — эх төслийн id-г үргэлж хамт бичнэ. */
  const setDes = useCallback(
    (updater: (prev: DeselectedIds) => DeselectedIds) => {
      setDesState((prev) => ({
        srcId: sourceId,
        des: updater(prev.srcId === sourceId ? prev.des : EMPTY_DESELECTION),
      }));
    },
    [sourceId],
  );

  const onToggle = useCallback(
    (path: TogglePath, next: boolean) => {
      setDes((prev) => applyToggle(prev, path, next));
    },
    [setDes],
  );
  const onExpand = useCallback(
    (key: string, isOpen: boolean) => {
      setExpState((prev) => {
        const nextSet = new Set(prev.srcId === sourceId ? prev.keys : EMPTY_KEYS);
        if (isOpen) nextSet.add(key);
        else nextSet.delete(key);
        return { srcId: sourceId, keys: nextSet };
      });
    },
    [sourceId],
  );

  const ctx: TreeCtx = { des, onToggle, expanded, onExpand, t };

  const runCommit = async (confirmReplace: boolean) => {
    setErrText(null);
    try {
      const res = await commit({ link: true, confirmReplace });
      // ⚠️ `apiFetch` нь задлагдахгүй 2xx-ыг `{}` болгодог — гүнзгий уншихаас
      // өмнө шалгана.
      const counts = res?.plan?.counts;
      setDoneCounts({ blocks: counts?.blocks ?? 0, tasks: counts?.tasks ?? 0 });
      onCopied();
    } catch (e) {
      /* ЗӨВХӨН `NOT_EMPTY` нь «баталгаажуулаад дахин оролд» гэсэн утгатай.
       * `HAS_PROGRESS` бол ХАТУУ зогсолт: тухайн төсөлд батлагдсан ахиц
       * бүртгэгдсэн бөгөөд бүтцийг нь солих нь оноон дэвтрийг (user_points)
       * сэргээх аргагүйгээр устгана — тиймээс баталгаажуулах цонхыг
       * НЭЭХГҮЙ, зөвхөн тайлбарыг харуулна. */
      if (e instanceof ApiError && e.code === 'NOT_EMPTY') {
        setConfirmOpen(true);
        return;
      }
      setErrText(t(errorKey(e)));
    }
  };

  const onCopyClick = () => {
    // Бүтэцтэй төсөл дээр дарж бичихийн өмнө ЗААВАЛ баталгаажуулна.
    if (hasExistingStructure) {
      setConfirmOpen(true);
      return;
    }
    void runCommit(false);
  };

  /* ⚠️ ЭНД ЭЗНИЙ ШИЙДВЭР #1-ИЙН НӨХЦӨЛ ХЭРЭГЖИНЭ.
   *
   * «Жинг үгчлэн хуулна» гэдгийг эзэн НЭГ Л нөхцөлтэйгээр зөвшөөрсөн:
   * гарах ДЭЭД ХЯЗГААР нь бичихээс ӨМНӨ дэлгэц дээр үргэлж харагдана.
   * Тиймээс төлөвлөгөөг ЗӨВХӨН тэр нь ОДООГИЙН сонголтынх мөн үед л
   * тоо болгож харуулна:
   *   – алдаатай бол ХУУЧИН тоог үлдээхгүй (`placeholderData` нь өмнөх
   *     төлөвлөгөөг байрандаа барьдаг тул «182 ажил, 41%» гэсэн ХУУРАМЧ
   *     тоо алдааны мессежийн хажууд зогсох байсан);
   *   – хуучирсан (`previewStale`) бол мөн адил — 100.0% харчихаад 5 чип
   *     унтраагаад ШУУД дарвал бодит нь 41% байх эрсдэлийг хаана. */
  const planFresh = previewError ? null : preview;
  const plan = previewStale ? null : planFresh;
  const counts = plan?.counts ?? null;
  const ceiling = plan?.ceiling_pct ?? null;
  const ceilingLow = ceiling !== null && ceiling < CEILING_OK_MIN;
  const prunedDrawings = plan?.pruned?.drawings?.length ?? 0;
  const prunedBlocks = plan?.pruned?.blocks?.length ?? 0;
  const zeroWeightDrawings =
    plan?.warnings?.find((w) => w.code === 'ZERO_WEIGHT_DRAWING')?.count ?? 0;

  const bannerText = errText ?? (previewError ? t(errorKey(previewError)) : null);
  const treeEmpty = index !== null && index.groups.length === 0;
  /* Төлөвлөгөө хараахан ирээгүй / хуучирсан үе.  `?copyFrom=`-аар шууд
   * нээх зам дээр мод нь эхний `dry_run` шийдэгдэхээс ӨМНӨ зурагддаг тул
   * энэ нь зөвхөн «дарж байхад» биш, НЭЭХ агшинд ч хэрэгтэй. */
  const planPending =
    sourceId != null &&
    index !== null &&
    !treeEmpty &&
    doneCounts === null &&
    previewError === null &&
    plan === null;
  /* `dry_run` нь бодит хуулбартай ЯГ ижил шалгуур ажиллуулдаг тул
   * урьдчилсан харалт алдаа өгсөн бол «Хуулах» нь мөн л алдаа өгнө —
   * товчийг идэвхгүй болгож дэмий 400-г хэрэглэгчид үзүүлэхгүй.
   * ⚠️ `plan !== null` нь ЗААВАЛ байх ёстой шалгуур: тааз нь дэлгэц дээр
   * бодитоор харагдаагүй байхад хуулахыг зөвшөөрөх нь эзний нөхцөлийг
   * зөрчинө. */
  const canCopy =
    sourceId != null &&
    index !== null &&
    !treeEmpty &&
    !committing &&
    doneCounts === null &&
    previewError === null &&
    plan !== null;

  const num = (v: number | null | undefined) => (v == null ? '—' : String(v));

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-border/60 pr-12">
        <SheetTitle className="text-base">{t('copyStructure.title')}</SheetTitle>
        <SheetDescription>{t('copyStructure.subtitle')}</SheetDescription>
        <div className="mt-2 flex flex-col gap-1">
          <span className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">
            {t('copyStructure.sourceLabel')}
          </span>
          <SourceProjectPicker
            value={sourceId}
            onChange={setSourceId}
            excludeProjectId={targetProjectId}
            {...(targetProjectName !== undefined ? { targetName: targetProjectName } : {})}
            targetShifr={targetShifr ?? null}
            disabled={committing || doneCounts !== null}
          />
        </div>
      </SheetHeader>

      {/* ── Их бие ── */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {sourceId == null && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {t('copyStructure.sourcePlaceholder')}
          </p>
        )}

        {sourceId != null && treeQuery.isLoading && (
          <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('copyStructure.loadingSource')}
          </p>
        )}

        {treeEmpty && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {t('copyStructure.emptySource')}
          </p>
        )}

        {index !== null && !treeEmpty && (
          <>
            {/* ── 1. Аль мэргэжлүүд? ── */}
            <section className="mb-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('copyStructure.step1Title')}
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setDes(() => emptyDeselection())}
                  >
                    {t('copyStructure.selectAll')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      setDes(() => ({
                        teams: new Set(index.allTeamIds),
                        blocks: new Set(index.allBlockIds),
                        drawings: new Set(index.allDrawingIds),
                        components: new Set(index.allComponentIds),
                        tasks: new Set(index.allTaskIds),
                      }))
                    }
                  >
                    {t('copyStructure.clearAll')}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {index.groups.map((group) => {
                  const sel = selectedCount(group.taskIds, des);
                  const selfDes = group.teamId != null && des.teams.has(group.teamId);
                  const state = triState(selfDes, sel, group.taskIds.length);
                  const on = state !== false;
                  return (
                    <button
                      key={group.teamId ?? 'none'}
                      type="button"
                      onClick={() => onToggle({ group }, !on)}
                      title={group.name}
                      aria-pressed={on}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                        on
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-muted/40 text-muted-foreground line-through',
                        state === 'indeterminate' && 'border-dashed',
                      )}
                    >
                      <span className="font-semibold">{group.code}</span>
                      {group.share !== null && (
                        <span className="tabular-nums opacity-80">
                          {group.share.toFixed(group.share % 1 === 0 ? 0 : 1)}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── 2. Бүтэц ── */}
            <Collapsible open={advanced} onOpenChange={setAdvanced}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('copyStructure.step2Title')}
                </h3>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="xs" className="gap-1">
                    {advanced ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {t('copyStructure.advanced')}
                  </Button>
                </CollapsibleTrigger>
              </div>

              {/* Хаалттай үед — зөвхөн нэг мөрийн товчлол (мянган мөр
                    mount ХИЙХГҮЙ). */}
              {!advanced && (
                <ul className="space-y-0.5 rounded-md border border-border/60 bg-muted/20 p-2">
                  {index.groups.map((group) => {
                    const sel = selectedCount(group.taskIds, des);
                    return (
                      <li
                        key={group.teamId ?? 'none'}
                        className={cn(
                          'flex items-center gap-2 text-xs',
                          sel === 0 && 'text-muted-foreground line-through',
                        )}
                      >
                        <span className="font-semibold">{group.code}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {group.name}
                        </span>
                        <span className="flex-shrink-0 text-micro tabular-nums text-muted-foreground">
                          {group.blocks.length} {t('copyStructure.blocksUnit')} · {sel}/
                          {group.taskIds.length} {t('copyStructure.tasksUnit')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <CollapsibleContent>
                <div className="rounded-md border border-border/60 p-1">
                  {index.groups.map((group) => (
                    <GroupRows key={group.teamId ?? 'none'} ctx={ctx} group={group} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>

      {/* ── Хөл: ХУУЛАГДАХ + ДЭЭД ХЯЗГААР ── */}
      <div className="mt-auto shrink-0 border-t border-border/60 bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {doneCounts !== null ? (
          <p className="mb-2 flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            <Sparkles className="size-3.5 flex-shrink-0" />
            {t('copyStructure.success', {
              blocks: doneCounts.blocks,
              tasks: doneCounts.tasks,
            })}
          </p>
        ) : (
          bannerText && (
            <p
              role="status"
              className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="size-3.5 flex-shrink-0" />
              {bannerText}
            </p>
          )
        )}

        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div
            className={cn(
              'flex items-center gap-1 text-xs tabular-nums',
              planPending && 'opacity-60',
            )}
          >
            {planPending && <Loader2 className="size-3 animate-spin" />}
            <span className="font-semibold">{t('copyStructure.willCopy')}</span>
            <span>
              {num(counts?.blocks)} {t('copyStructure.blocksUnit')} · {num(counts?.drawings)}{' '}
              {t('copyStructure.drawingsUnit')} · {num(counts?.tasks)}{' '}
              {t('copyStructure.tasksUnit')}
            </span>
          </div>

          {/* ⚠️ ДЭЭД ХЯЗГААР — ХЭЗЭЭ Ч нуухгүй, ХЭЗЭЭ Ч зөөлрүүлэхгүй.
                Хэсэгчилсэн хуулбар нь төслийн дээд утгыг хуулиар бууруулдаг
                бөгөөд админ «Хуулах» дарахаасаа ӨМНӨ үүнийг харах ёстой. */}
          <div className="flex items-center gap-1.5 text-xs tabular-nums">
            <span className="text-micro font-semibold tracking-wide text-muted-foreground uppercase">
              {t('copyStructure.ceiling')}
            </span>
            <span
              className={cn(
                'text-sm font-bold',
                ceiling === null
                  ? 'text-muted-foreground'
                  : ceilingLow
                    ? 'text-destructive'
                    : 'text-success',
              )}
            >
              {ceiling === null ? '—' : `${ceiling.toFixed(1)}%`}
            </span>
          </div>
        </div>

        {/* Хуучирсан үед ӨМНӨХ таазны тайлбарыг ҮЛДЭЭХГҮЙ — «Тооцоолж
              байна…» гэж ил хэлнэ.  Хэрэглэгч тоог одоогийнх гэж уншиж
              болохгүй. */}
        {planPending && (
          <p className="mb-2 flex items-center gap-1.5 text-micro text-muted-foreground">
            <Loader2 className="size-3 flex-shrink-0 animate-spin" />
            {t('copyStructure.previewStale')}
          </p>
        )}

        {!planPending && ceiling !== null && (
          <p
            className={cn(
              'mb-2 text-micro',
              ceilingLow ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {ceilingLow
              ? t('copyStructure.ceilingWarning', { pct: ceiling.toFixed(1) })
              : t('copyStructure.ceilingOk')}
          </p>
        )}

        {/* Багийн хувь хэмжээ нь ҮРГЭЛЖ бүтнээрээ солигдоно (сервер тал
              `project_team_shares`-ийг DELETE + INSERT хийдэг) — төлөвлөгөө
              харагдаж байгаа бүх үед үүнийг сануулна. */}
        {plan !== null && doneCounts === null && (
          <p className="mb-2 text-micro text-muted-foreground">{t('copyStructure.rosterNotice')}</p>
        )}

        {(prunedDrawings > 0 || prunedBlocks > 0 || zeroWeightDrawings > 0) && (
          <ul className="mb-2 space-y-0.5 text-micro text-warning">
            {prunedDrawings > 0 && (
              <li>{t('copyStructure.prunedDrawings', { count: prunedDrawings })}</li>
            )}
            {prunedBlocks > 0 && (
              <li>{t('copyStructure.prunedBlocks', { count: prunedBlocks })}</li>
            )}
            {zeroWeightDrawings > 0 && (
              <li>{t('copyStructure.zeroWeightDrawing', { count: zeroWeightDrawings })}</li>
            )}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2">
          {doneCounts === null ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={committing}
              >
                {t('copyStructure.cancel')}
              </Button>
              <Button type="button" size="sm" onClick={onCopyClick} disabled={!canCopy}>
                {committing && <Loader2 className="size-3.5 animate-spin" />}
                {committing ? t('copyStructure.copying') : t('copyStructure.copy')}
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>
      {/* Бүтэцтэй төсөл дээр хуулах — тусдаа баталгаажуулалт.  Сервер мөн
            409 NOT_EMPTY буцаадаг тул хоёр зам ижил цонх руу нийлнэ. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('copyStructure.notEmptyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('copyStructure.notEmptyBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('copyStructure.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void runCommit(true);
              }}
            >
              {t('copyStructure.notEmptyConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default CopyStructureSheet;
