/**
 * «Төслийн хугацаанууд» — milestone-ийн БҮРЭН CRUD, 2 түвшний мод.
 *
 * Төсөлд хэдэн ч нэрлэсэн хугацаа тавина, тус бүр нь дэд хугацаатай байж
 * болно (migration 0173):
 *
 *   ☐ Экспертизийн дүгнэлт гарсан байх        09-15
 *     ☐ Тооцооны хэсэг бүрэн                  09-01
 *     ☐ Зураг төслийн багц хэвлэгдсэн         09-08
 *   ☐ Захиалагчид танилцуулах                 10-01
 *
 * ⚠️ ЭДГЭЭР НЬ АЖЛЫН НЭГЖ БИШ.  `project_milestones` нь blocks→drawings→
 *    components→tasks модонд огт байхгүй тусдаа хүснэгт тул явцын нэгтгэл,
 *    оноо, leaderboard-д ОГТ нөлөөлөхгүй (0148-ийн `task_deadlines`-тай
 *    ижил зарчим).
 *
 * ⚠️ ГҮН = 2.  Дэд хугацааны доор дахин дэд хугацаа НЭМЭХГҮЙ — сервер тал
 *    ч 400 буцаана, UI ч товчийг харуулахгүй.
 *
 * Эрх: admin + senior.  Сервер тал мөр бүрд `can_edit` буцаана; энд түүнийг
 * л дагана (frontend дүрийн шалгалт хийхгүй — жинхэнэ хаалт сервер тал).
 *
 * БИЕЛСЭН ЭСЭХ хоёр эх сурвалжтай:
 *   · ажилтай холбоогүй → гараар чагтална (`done_at`)
 *   · блоктой холбогдсон → тухайн блокийн БҮХ таск дуусахад автоматаар
 * Холбоостой мөрөнд чагт огт харагдахгүй — эс бөгөөс «яагаад чагт минь
 * ажиллахгүй байна вэ» гэсэн ойлгомжгүй байдал үүснэ.
 */
import { useMemo, useState } from 'react';
import {
  CalendarPlus,
  Flag,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import type { User } from '@/shared/types';
import { RISK_TONE, riskDetail, riskLabelKey } from '@/features/timeline/lib/riskDisplay';

import {
  createMilestone,
  deleteMilestone,
  toggleMilestoneDone,
  updateMilestone,
} from './api';
import { AssigneePicker } from './AssigneePicker';
import type { DeadlineItem, MilestoneInput } from './types';

/** Блокийн сонголт.  `GET /api/blocks?project_id=` нь бүх блокийг өгнө —
 *  хугацааны жагсаалт дахь `block` мөрүүд нь ЗӨВХӨН огноотой таск бүхий
 *  блокуудыг агуулдаг тул тэднийг сонголт болгож болохгүй. */
interface BlockOption {
  id: number;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Нэг хугацааны форм (нэмэх ба засах хоёуланд)                       */
/* ------------------------------------------------------------------ */

interface FormDraft {
  title: string;
  due_date: string;
  note: string;
  /** Хариуцагчид — ОЛОН хүн (migration 0176).  Нэг хугацааг 2-3 хүн
   *  хамтарч барьдаг тул ганц эзэн нь бодит байдалд тохирдоггүй байв. */
  assignee_ids: number[];
  block_id: string;
}

const EMPTY_DRAFT: FormDraft = {
  title: '',
  due_date: '',
  note: '',
  assignee_ids: [],
  block_id: '',
};

/** `<select>`-ийн мөрийг API-ийн `number | null` болгоно.  Хоосон мөр =
 *  «заагаагүй» — 0 биш null (0 нь хүчинтэй id мэт харагдана). */
function toIdOrNull(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

function MilestoneForm({
  draft,
  setDraft,
  users,
  blocks,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  /** Дэд хугацаанд блокийн холбоос санал болгохгүй — дэд хугацаа нь
   *  эцгийнхээ дотоод шалгах цэг бөгөөд бүтэн блоктой дүйцэх нь ховор. */
  allowLink = true,
}: {
  draft: FormDraft;
  setDraft: (d: FormDraft) => void;
  users: User[];
  blocks: BlockOption[];
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  allowLink?: boolean;
}) {
  const { t } = useLanguage();
  const valid = draft.title.trim().length > 0 && Boolean(draft.due_date);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <input
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder={t('deadlines.titlePlaceholder')}
        className={inputClass}
        autoFocus
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t('deadlines.dueDate')}
          </span>
          <input
            type="date"
            value={draft.due_date}
            onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
            className={inputClass}
          />
        </label>

        {/* Хариуцагчид — ОЛОН сонголт.  Хайлт, сонгогдсоны эрэмбэ зэрэг
            дүрэм нь `AssigneePicker`-т — `MilestoneDialog`-той ХУВААЛЦАНА,
            тиймээс хоёр газар зөрөхгүй. */}
        <AssigneePicker
          users={users}
          value={draft.assignee_ids}
          onChange={(ids) => setDraft({ ...draft, assignee_ids: ids })}
        />
      </div>

      {allowLink && (
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t('deadlines.linkBlock')}
          </span>
          <select
            value={draft.block_id}
            onChange={(e) => setDraft({ ...draft, block_id: e.target.value })}
            className={inputClass}
          >
            <option value="">{t('deadlines.linkNone')}</option>
            {blocks.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="block text-[10px] leading-snug text-muted-foreground">
            {t('deadlines.linkHint')}
          </span>
        </label>
      )}

      <input
        value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        placeholder={t('deadlines.notePlaceholder')}
        className={inputClass}
      />

      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || !valid}
          onClick={onSubmit}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3.5 w-3.5" />
          )}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Нэг мөр                                                            */
/* ------------------------------------------------------------------ */

function MilestoneNode({
  item,
  indent,
  busy,
  canEdit,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: DeadlineItem;
  indent: boolean;
  busy: boolean;
  /** Серверийн `item.can_edit` дээр дуудагчийн `readOnly` тавигдсан утга.
   *  ХОЁУЛАА үнэн байж байж товч гарна — эс бөгөөс зөвхөн харах ёстой
   *  гадаргуу (Timeline дээрх admin БИШ хэрэглэгч) 403 өгөх товч харуулна. */
  canEdit: boolean;
  onToggle: (done: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const tone = RISK_TONE[item.risk_state];
  const detail = riskDetail(t, item.risk_state, item.days_left, null, item.days_to_start);
  const linked = Boolean(item.link);

  return (
    <div
      className={cn(
        'group flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/50',
        indent && 'ml-4 border-l border-border/60 pl-3',
      )}
    >
      {/* Холбоостой мөрөнд чагт БАЙХГҮЙ — төлөв нь явцаас гардаг.  Оронд нь
          холбоосын дүрс тавьж «энэ өөрөө хаагдана» гэдгийг хэлнэ. */}
      {linked ? (
        <Link2
          className="mt-1 h-3.5 w-3.5 flex-none text-info"
          aria-label={t('deadlines.linkedHint')}
        />
      ) : (
        <input
          type="checkbox"
          checked={item.done}
          disabled={!canEdit || busy}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={t('deadlines.markDone')}
          className="mt-1 h-3.5 w-3.5 flex-none accent-current"
        />
      )}

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-sm font-medium',
            item.done && 'text-muted-foreground line-through',
          )}
        >
          {item.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {/* Огноо + төлөв.  Өнгөний хажууд ЗААВАЛ текст (riskDisplay-ийн дүрэм). */}
          <span
            className={cn(
              'inline-flex items-center rounded border px-1 py-px tabular-nums',
              tone.chip,
            )}
          >
            {item.due_date ?? t('deadlines.noDate')}
          </span>
          <span>{detail || t(riskLabelKey(item.risk_state))}</span>
          {item.link && (
            <span
              className="inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded bg-info/10 px-1 py-px text-info"
              title={t('deadlines.linkedHint')}
            >
              <Link2 className="h-2.5 w-2.5 flex-none" />
              <span className="truncate">{item.link.name}</span>
            </span>
          )}
          {item.people.length > 0 && (
            <span className="truncate">{item.people.map((p) => p.full_name).join(', ')}</span>
          )}
          {item.note && <span className="truncate italic">· {item.note}</span>}
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            disabled={busy}
            onClick={onEdit}
            aria-label={t('common.edit')}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-danger hover:text-danger"
            disabled={busy}
            onClick={onDelete}
            aria-label={t('common.delete')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Удирдах карт                                                       */
/* ------------------------------------------------------------------ */

export function MilestoneManager({
  projectId,
  items,
  canManage,
  loading = false,
  readOnly = false,
  className,
}: {
  projectId: number;
  /** `/api/deadlines/project/:id`-аас ирсэн БҮХ мөр — эндээс milestone-ыг
   *  шүүнэ.  Тусад нь дуудлага хийхгүй: нэг эх сурвалж, нэг кэш. */
  items: DeadlineItem[];
  /** Сервер талын `can_manage_milestones`.  Жагсаалт хоосон үед мөрийн
   *  `can_edit` мэдэгдэхгүй тул түвшний туг заавал хэрэгтэй. */
  canManage: boolean;
  loading?: boolean;
  /**
   * БҮХ засварын товчийг албадан унтраана — мөрийн `can_edit` үнэн байсан ч.
   *
   * ⚠️ Анхдагч нь `false` тул төслийн «Хугацаа» таб (`ProjectDeadlinesTab`)
   *    ЯГ хуучнаараа ажиллана.  Timeline хуудас нь admin БИШ уншигчид
   *    үүнийг `true`-ээр өгнө: сервер тал milestone-ийн бичилтийг admin +
   *    senior-т нээлттэй үлдээсэн (төслийн таб түүнээс хамаарна) атал
   *    Timeline дээр ЗӨВХӨН admin засах ёстой.
   */
  readOnly?: boolean;
  /** Гаднаас өгөх нэмэлт класс — самбар дотор картын хүрээг авахад. */
  className?: string;
}) {
  const { t } = useLanguage();
  /** Бодит удирдах эрх — түвшний туг ба зөвхөн-унших горим хоёрын огтлолцол. */
  const manage = canManage && !readOnly;
  const [busy, setBusy] = useState(false);
  /** Нээлттэй форм: null = хаалттай, 'root' = шинэ дээд түвшин,
   *  {parent:id} = шинэ дэд, {edit:id} = засварлаж байна. */
  const [form, setForm] = useState<
    null | { mode: 'root' } | { mode: 'child'; parentId: number } | { mode: 'edit'; id: number }
  >(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);

  const milestones = useMemo(() => items.filter((i) => i.kind === 'milestone'), [items]);

  // Сонголтын жагсаалтуудыг ЗӨВХӨН эрхтэй хүнд татна — унших эрхтэй ч
  // засах эрхгүй хүнд `/users` нь хэрэггүй хүсэлт.
  const usersQuery = useApiQuery<{ users: User[] }>('/users', {
    enabled: manage,
    retry: false,
  });
  const blocksQuery = useApiQuery<{ blocks: BlockOption[] }>(
    ['/blocks', projectId],
    `/blocks?project_id=${projectId}`,
    { enabled: manage, retry: false },
  );
  const users = usersQuery.data?.users ?? [];
  const blocks = blocksQuery.data?.blocks ?? [];

  /** Дээд түвшин → түүний дэд мөрүүд.  Хоёр түвшнээс гүн бол сервер тал
   *  аль хэдийн хориглосон тул энд рекурс хэрэггүй. */
  const tree = useMemo(() => {
    const roots = milestones.filter((m) => m.parent_id == null);
    const byParent = new Map<number, DeadlineItem[]>();
    for (const m of milestones) {
      if (m.parent_id == null) continue;
      const list = byParent.get(m.parent_id) ?? [];
      list.push(m);
      byParent.set(m.parent_id, list);
    }
    /**
     * ЭРЭМБЭ: биелээгүй нь дээр (огноогоор), БИЕЛСЭН нь ЁРООЛД.
     *
     * Энэ компонент нь төслийн «Хугацаа» таб БОЛОН хуваарийн мөрийн
     * дэлгэрэнгүй самбар ХОЁУЛАНД гарна — нэг зүйл хоёр газар өөр
     * дарааллаар харагдвал «энэ мөр хаачив?» гэсэн асуулт төрнө.  Хугацаа
     * хэтэрсэн нь огноо өсөх эрэмбэд аяндаа хамгийн дээр гарна.
     */
    const byDoneThenDate = (a: DeadlineItem, b: DeadlineItem) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.due_date ?? '').localeCompare(b.due_date ?? '');
    };
    return roots
      .slice()
      .sort(byDoneThenDate)
      .map((root) => ({
        root,
        children: (byParent.get(root.id) ?? []).slice().sort(byDoneThenDate),
      }));
  }, [milestones]);

  const run = async (fn: () => Promise<void>, okKey: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      toast.success(t(okKey));
      return true;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Биелсэн эсэхийг сэлгэх.
   *
   * Эцгийг тэмдэглэхэд дэд хугацаанууд нь СЕРВЕР талд дагаж хаагддаг тул
   * хэдэн мөр өөрчлөгдсөнийг toast-оор ИЛ хэлнэ.  Чимээгүй бөөнөөр
   * өөрчлөх нь «би нэг мөр дарсан атал яагаад гурав хаагдав?» гэсэн
   * эргэлзээ төрүүлнэ.
   */
  const toggleDone = async (milestoneId: number, done: boolean): Promise<void> => {
    setBusy(true);
    try {
      const res = await toggleMilestoneDone(milestoneId, done);
      const n = res.children_marked ?? 0;
      toast.success(n > 0 ? t('deadlines.doneCascaded', { n }) : t('deadlines.saved'));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const closeForm = () => {
    setForm(null);
    setDraft(EMPTY_DRAFT);
  };

  const openEdit = (m: DeadlineItem) => {
    setForm({ mode: 'edit', id: m.id });
    setDraft({
      title: m.title,
      due_date: m.due_date ?? '',
      note: m.note ?? '',
      assignee_ids: m.people.map((p) => p.id),
      block_id: m.link?.kind === 'block' ? String(m.link.id) : '',
    });
  };

  const submit = async () => {
    if (!form) return;
    const base: MilestoneInput = {
      title: draft.title.trim(),
      due_date: draft.due_date,
      note: draft.note.trim() || null,
      assignee_ids: draft.assignee_ids,
    };

    if (form.mode === 'edit') {
      // Засварт холбоосыг ҮРГЭЛЖ дамжуулна (хоосон = тайлах) — сервер тал
      // block/task хоёрыг ХАМТ шинэчилдэг тул нэгийг нь дуугүй орхивол
      // нөгөө нь хуучнаараа үлдэж эргэлзээ төрүүлнэ.
      const ok = await run(
        () =>
          updateMilestone(form.id, {
            ...base,
            block_id: toIdOrNull(draft.block_id),
            task_id: null,
          }),
        'deadlines.saved',
      );
      if (ok) closeForm();
      return;
    }

    const parentId = form.mode === 'child' ? form.parentId : null;
    const ok = await run(
      () =>
        createMilestone({
          ...base,
          title: base.title ?? '',
          due_date: base.due_date ?? '',
          project_id: projectId,
          parent_id: parentId,
          // Дэд хугацаанд холбоос санал болгодоггүй тул үргэлж null.
          block_id: parentId == null ? toIdOrNull(draft.block_id) : null,
        }).then(() => undefined),
      'deadlines.created',
    );
    if (ok) closeForm();
  };

  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Flag className="h-3.5 w-3.5" />
            {t('deadlines.milestonesTitle')}
            {milestones.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
                {milestones.length}
              </span>
            )}
          </div>
          {manage && form === null && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setForm({ mode: 'root' });
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('deadlines.addMilestone')}
            </Button>
          )}
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('deadlines.milestonesHint')}
        </p>

        {form?.mode === 'root' && (
          <MilestoneForm
            draft={draft}
            setDraft={setDraft}
            users={users}
            blocks={blocks}
            busy={busy}
            submitLabel={t('common.add')}
            onSubmit={submit}
            onCancel={closeForm}
          />
        )}

        {loading ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted/40" />
            ))}
          </div>
        ) : tree.length === 0 && form === null ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
            <Flag className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">{t('deadlines.milestonesEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {tree.map(({ root, children }) => (
              <div key={root.key} className="space-y-1">
                {form?.mode === 'edit' && form.id === root.id ? (
                  <MilestoneForm
                    draft={draft}
                    setDraft={setDraft}
                    users={users}
                    blocks={blocks}
                    busy={busy}
                    submitLabel={t('common.save')}
                    onSubmit={submit}
                    onCancel={closeForm}
                  />
                ) : (
                  <MilestoneNode
                    item={root}
                    indent={false}
                    busy={busy}
                    canEdit={root.can_edit && !readOnly}
                    onToggle={(done) => void toggleDone(root.id, done)}
                    onEdit={() => openEdit(root)}
                    onDelete={() =>
                      void run(() => deleteMilestone(root.id), 'deadlines.deleted')
                    }
                  />
                )}

                {children.map((child) =>
                  form?.mode === 'edit' && form.id === child.id ? (
                    <div key={child.key} className="ml-4 border-l border-border/60 pl-3">
                      <MilestoneForm
                        draft={draft}
                        setDraft={setDraft}
                        users={users}
                        blocks={blocks}
                        busy={busy}
                        submitLabel={t('common.save')}
                        onSubmit={submit}
                        onCancel={closeForm}
                        allowLink={false}
                      />
                    </div>
                  ) : (
                    <MilestoneNode
                      key={child.key}
                      item={child}
                      indent
                      busy={busy}
                      canEdit={child.can_edit && !readOnly}
                      onToggle={(done) => void toggleDone(child.id, done)}
                      onEdit={() => openEdit(child)}
                      onDelete={() =>
                        void run(() => deleteMilestone(child.id), 'deadlines.deleted')
                      }
                    />
                  ),
                )}

                {/* Дэд хугацаа нэмэх — ЗӨВХӨН дээд түвшинд (гүн = 2). */}
                {root.can_edit &&
                  !readOnly &&
                  (form?.mode === 'child' && form.parentId === root.id ? (
                    <div className="ml-4 border-l border-border/60 pl-3">
                      <MilestoneForm
                        draft={draft}
                        setDraft={setDraft}
                        users={users}
                        blocks={blocks}
                        busy={busy}
                        submitLabel={t('common.add')}
                        onSubmit={submit}
                        onCancel={closeForm}
                        allowLink={false}
                      />
                    </div>
                  ) : (
                    form === null && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(EMPTY_DRAFT);
                          setForm({ mode: 'child', parentId: root.id });
                        }}
                        className="ml-7 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-primary/70 transition-colors hover:bg-muted/60 hover:text-primary"
                      >
                        <CalendarPlus className="h-3 w-3" />
                        {t('deadlines.addSubMilestone')}
                      </button>
                    )
                  ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MilestoneManager;
