/**
 * Эцсийн хугацаа ҮҮСГЭХ / ЗАСАХ харилцах цонх — хуваарийн хуудсын толгойд.
 *
 * Төслийн «Эцсийн хугацаа» таб ба хуваарийн мөрийн дэлгэрэнгүй самбар нь
 * мөрөндөө суусан формтой (`MilestoneManager`); энэ нь ТӨСӨЛ СОНГОХ шаттай,
 * бие даасан цонх — «аль ч төсөл дээр хурдан нэмэх» зам.  Бүгд
 * `AssigneePicker`-ийг хуваалцана — хайлт, сонголтын дүрэм нэг газар.
 *
 * ⚠️ Блокийн жагсаалт нь СОНГОСОН ТӨСЛӨӨС хамаарна.  Төсөл солиход
 *    сонгосон блокийг заавал цэвэрлэнэ — эс бөгөөс өөр төслийн блокийн id
 *    үлдэж, сервер 400 буцаана («Холбох блок энэ төсөлд олдсонгүй»).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { cn } from '@/shared/lib/utils';
import type { User } from '@/shared/types';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';

import { AssigneePicker } from './AssigneePicker';
import { createMilestone, updateMilestone } from './api';
import { deadlineProjectName } from './lib/display';
import type { DeadlineItem } from './types';

interface ProjectOption {
  id: number;
  name: string;
  display_title?: string | null;
  status?: string;
}
interface BlockOption {
  id: number;
  name: string;
}

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

export function MilestoneDialog({
  open,
  onOpenChange,
  /** Байвал ЗАСАХ горим; байхгүй бол ҮҮСГЭХ. */
  item,
  /** Үүсгэх үед урьдчилан сонгох төсөл (жагсаалтын контекстээс). */
  defaultProjectId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item?: DeadlineItem | null;
  defaultProjectId?: number | null;
  onSaved?: () => void;
}) {
  const { t } = useLanguage();
  const editing = Boolean(item);

  const [projectId, setProjectId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [assignees, setAssignees] = useState<number[]>([]);
  const [blockId, setBlockId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Цонх нээгдэх бүрд төлвийг ЭХЛЭЭС нь тавина — өмнөх засварын үлдэгдэл
  // шинэ мөрөнд урсах нь хамгийн эвгүй алдаа.
  useEffect(() => {
    if (!open) return;
    if (item) {
      setProjectId(item.kind === 'project' ? item.id : (item.project_id ?? null));
      setTitle(item.title);
      setDue(item.due_date ?? '');
      setNote(item.note ?? '');
      setAssignees(item.people.map((p) => p.id));
      setBlockId(item.link?.kind === 'block' ? String(item.link.id) : '');
    } else {
      setProjectId(defaultProjectId ?? null);
      setTitle('');
      setDue('');
      setNote('');
      setAssignees([]);
      setBlockId('');
    }
  }, [open, item, defaultProjectId]);

  const usersQuery = useApiQuery<{ users: User[] }>('/users', { enabled: open, retry: false });
  const projectsQuery = useApiQuery<{ projects: ProjectOption[] }>('/projects', {
    enabled: open && !editing,
    retry: false,
  });
  const blocksQuery = useApiQuery<{ blocks: BlockOption[] }>(
    ['/blocks', projectId ?? 0],
    `/blocks?project_id=${projectId ?? 0}`,
    { enabled: open && projectId != null, retry: false },
  );

  const users = usersQuery.data?.users ?? [];
  const blocks = blocksQuery.data?.blocks ?? [];
  const projects = useMemo(
    () =>
      (projectsQuery.data?.projects ?? [])
        .filter((p) => p.status !== 'archived')
        .map((p) => ({ id: p.id, label: deadlineProjectName(p.display_title || p.name) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [projectsQuery.data],
  );

  const isSub = editing && item?.parent_id != null;
  const valid = title.trim().length > 0 && Boolean(due) && projectId != null;

  const submit = async () => {
    if (!valid || projectId == null) return;
    setBusy(true);
    try {
      if (editing && item) {
        await updateMilestone(item.id, {
          title: title.trim(),
          due_date: due,
          note: note.trim() || null,
          assignee_ids: assignees,
          // Дэд хугацаанд блокийн холбоос санал болгодоггүй тул үргэлж null.
          block_id: isSub ? null : toIdOrNull(blockId),
          task_id: null,
        });
        toast.success(t('deadlines.saved'));
      } else {
        await createMilestone({
          project_id: projectId,
          title: title.trim(),
          due_date: due,
          note: note.trim() || null,
          assignee_ids: assignees,
          block_id: toIdOrNull(blockId),
        });
        toast.success(t('deadlines.created'));
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('deadlines.dialogEdit') : t('deadlines.dialogCreate')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Төсөл — ЗӨВХӨН үүсгэх үед сонгоно.  Засварт төслийг солих нь
              дэд хугацаа, блокийн холбоосыг бүхэлд нь эвдэх тул зөвшөөрөхгүй. */}
          {editing ? (
            <div className="text-xs text-muted-foreground">
              {t('deadlines.detailProject')}:{' '}
              <span className="font-medium text-foreground">
                {deadlineProjectName(
                  item?.kind === 'project' ? item.title : (item?.project_title ?? ''),
                )}
              </span>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t('deadlines.detailProject')}
              </span>
              <Select
                value={projectId != null ? String(projectId) : ''}
                onValueChange={(v) => {
                  setProjectId(Number(v));
                  // Төсөл солигдвол блокийн холбоос хүчингүй болно.
                  setBlockId('');
                }}
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue placeholder={t('deadlines.dialogPickProject')} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('deadlines.dialogTitle')}
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('deadlines.titlePlaceholder')}
              className={inputClass}
              autoFocus
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('deadlines.dueDate')}
            </span>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className={inputClass}
            />
          </label>

          <AssigneePicker users={users} value={assignees} onChange={setAssignees} />

          {/* Блокийн холбоос — дэд хугацаанд санал болгохгүй. */}
          {!isSub && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {t('deadlines.linkBlock')}
              </span>
              <select
                value={blockId}
                onChange={(e) => setBlockId(e.target.value)}
                disabled={projectId == null}
                className={cn(inputClass, projectId == null && 'opacity-60')}
              >
                <option value="">{t('deadlines.linkNone')}</option>
                {blocks.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs leading-snug text-muted-foreground">
                {t('deadlines.linkHint')}
              </span>
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('deadlines.detailNote')}
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('deadlines.notePlaceholder')}
              className={inputClass}
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {editing ? t('common.save') : t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `<select>`-ийн мөрийг API-ийн `number | null` болгоно.  Хоосон мөр =
 *  «заагаагүй» — 0 биш null (0 нь хүчинтэй id мэт харагдана). */
function toIdOrNull(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default MilestoneDialog;
