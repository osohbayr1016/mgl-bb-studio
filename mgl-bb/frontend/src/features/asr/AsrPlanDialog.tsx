import { useMemo, useState } from 'react';
import { CalendarX, Loader2, MapPin } from 'lucide-react';
import { useApiQuery } from '@/shared/api/useApi';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { teamChipClass } from '@/shared/lib/team-colors';
import { todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import type { User } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { AssigneePicker } from '@/features/deadlines/AssigneePicker';
import {
  useAsrProjectOptions,
  useAsrVisitPlanCancel,
  useAsrVisitPlanCreate,
  useAsrVisitPlanPatch,
  useAsrVisitPlansInvalidate,
} from '@/features/projects/asr/api';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import type { AsrVisitPlan } from '@/features/projects/asr/types';

/**
 * Хяналтын хуваарь — үүсгэх / засах / харах цонх (миграц 0331).
 *
 * admin/senior (`canManage`) засна; бусад ажилтан зөвхөн харна — гэхдээ
 * мэдэгдлийн холбоосоор (`?plan=<id>`) ирсэн хүн ЯГ ЭНЭ цонхыг нээж, хэзээ
 * хаашаа хэнтэй явахаа бүтэн уншина.
 *
 * ⚠️ Хадгалахад сервер шинээр нэмэгдсэн/өөрчлөлт хүрсэн хүн бүрд мэдэгдэл
 *    илгээдэг (`lib/asrVisitPlanRoutes.ts`) — энэ цонх мэдэгдэл ЗОХИОДОГГҮЙ,
 *    зөвхөн хариун дахь `notified` тоог toast-оор хэлнэ.
 */
export function AsrPlanDialog({
  open,
  onOpenChange,
  plan,
  defaultProjectId,
  canManage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = шинэ хуваарь. */
  plan: AsrVisitPlan | null;
  /** Төслийн workspace-ээс нээхэд урьдчилан сонгогдоно (солигдохгүй). */
  defaultProjectId?: number;
  canManage: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Маягтын төлөв нь `key`-ээр дахин үүснэ (effect + setState биш):
          өөр хуваарь нээх, эсвэл засаад дахин нээхэд хуучин утга үлдэхгүй. */}
      {open && (
        <PlanForm
          key={plan ? `plan-${plan.id}-${plan.updated_at}` : `new-${defaultProjectId ?? 0}`}
          plan={plan}
          defaultProjectId={defaultProjectId}
          canManage={canManage}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function PlanForm({
  plan,
  defaultProjectId,
  canManage,
  onClose,
}: {
  plan: AsrVisitPlan | null;
  defaultProjectId?: number;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const editable = canManage && (plan == null || plan.status === 'planned');

  const [projectId, setProjectId] = useState<number | null>(
    plan?.project_id ?? defaultProjectId ?? null,
  );
  const [date, setDate] = useState(plan?.visit_date ?? todayUB());
  const [time, setTime] = useState(plan?.visit_time ?? '');
  const [note, setNote] = useState(plan?.note ?? '');
  const [userIds, setUserIds] = useState<number[]>(plan?.members.map((m) => m.user_id) ?? []);

  const projects = useAsrProjectOptions(editable);
  const usersQuery = useApiQuery<{ users: User[] }>('/users', { enabled: editable, retry: false });
  const pickable = useMemo(
    () =>
      (usersQuery.data?.users ?? []).filter(
        (u) =>
          u.status === 'active' &&
          (u.role === 'engineer' ||
            u.role === 'architect' ||
            u.role === 'senior' ||
            u.role === 'admin'),
      ),
    [usersQuery.data],
  );

  const create = useAsrVisitPlanCreate();
  const patch = useAsrVisitPlanPatch();
  const cancel = useAsrVisitPlanCancel();
  const invalidate = useAsrVisitPlansInvalidate();
  const busy = create.isPending || patch.isPending || cancel.isPending;

  const selectedProject = useMemo(
    () => (projects.data?.projects ?? []).find((p) => p.id === projectId) ?? null,
    [projects.data, projectId],
  );

  const save = async () => {
    if (!projectId) {
      toast.error(t('asr.plans.pickProject'));
      return;
    }
    if (userIds.length === 0) {
      toast.error(t('asr.plans.pickPeople'));
      return;
    }
    const body = {
      project_id: projectId,
      visit_date: date,
      visit_time: time.trim() || null,
      note: note.trim() || null,
      user_ids: userIds,
    };
    try {
      const res = plan
        ? await patch.mutateAsync({ id: plan.id, ...body })
        : await create.mutateAsync(body);
      invalidate();
      toast.success(
        t('asr.plans.saved'),
        res.notified > 0 ? t('asr.plans.notifiedCount', { n: res.notified }) : undefined,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const cancelPlan = async () => {
    if (!plan) return;
    const ok = await confirmDialog({
      title: t('asr.plans.cancel'),
      description: t('asr.plans.cancelConfirm'),
      confirmText: t('asr.plans.cancel'),
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await cancel.mutateAsync({ id: plan.id });
      invalidate();
      toast.success(
        t('asr.plans.cancelled'),
        res.notified > 0 ? t('asr.plans.notifiedCount', { n: res.notified }) : undefined,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    }
  };

  const title = plan
    ? editable
      ? t('asr.plans.dialogEdit')
      : t('asr.plans.dialogView')
    : t('asr.plans.dialogNew');
  const location = plan?.project_location ?? null;
  const shifr = plan?.project_shifr ?? selectedProject?.shifr ?? null;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {editable ? t('asr.plans.dialogHint') : t('asr.plans.viewOnly')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {/* Төсөл */}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t('asr.plans.project')}
          </span>
          {editable && !defaultProjectId && !plan ? (
            <Select
              value={projectId != null ? String(projectId) : ''}
              onValueChange={(v) => setProjectId(Number(v))}
            >
              <SelectTrigger className="h-9 w-full text-sm">
                <SelectValue placeholder={t('asr.plans.pickProject')} />
              </SelectTrigger>
              <SelectContent>
                {(projects.data?.projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {asrProjectName(p.name)}
                    {p.shifr ? ` · ${p.shifr}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {asrProjectName(plan?.project_name ?? selectedProject?.name) ?? `#${projectId ?? ''}`}
            </div>
          )}
          {(location || shifr) && (
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {location}
                </span>
              )}
              {shifr && <span className="font-mono">{shifr}</span>}
            </div>
          )}
        </label>

        {/* Огноо + цаг */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('asr.plans.date')}</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!editable}
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('asr.plans.time')}</span>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!editable}
            />
          </label>
        </div>

        {/* Явах хүмүүс */}
        {editable ? (
          usersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('common.loading')}
            </div>
          ) : (
            <AssigneePicker
              users={pickable}
              value={userIds}
              onChange={setUserIds}
              label={t('asr.plans.members')}
              maxHeight="max-h-48"
            />
          )
        ) : (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('asr.plans.members')}
            </span>
            <div className="flex flex-wrap gap-1">
              {(plan?.members ?? []).map((m) => (
                <Badge
                  key={m.user_id}
                  variant="outline"
                  className={cn('text-xs font-normal', teamChipClass(m.team_code))}
                >
                  {formatDisplayName(m.full_name) || `#${m.user_id}`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Тэмдэглэл */}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t('asr.plans.note')}</span>
          {editable ? (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t('asr.plans.notePlaceholder')}
            />
          ) : (
            <div className="whitespace-pre-line rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {plan?.note || '—'}
            </div>
          )}
        </label>

        {plan?.created_by_name && (
          <p className="text-xs text-muted-foreground">
            {t('asr.plans.createdBy', { name: plan.created_by_name })}
          </p>
        )}
        {plan?.status === 'cancelled' && (
          <Badge variant="outline" className="text-xs">
            {t('asr.plans.statusCancelled')}
          </Badge>
        )}
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        {editable && plan ? (
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5 text-danger"
            disabled={busy}
            onClick={() => void cancelPlan()}
          >
            <CalendarX className="h-4 w-4" />
            {t('asr.plans.cancel')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {editable ? t('common.cancel') : t('common.close')}
          </Button>
          {editable && (
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('asr.plans.save')}
            </Button>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
