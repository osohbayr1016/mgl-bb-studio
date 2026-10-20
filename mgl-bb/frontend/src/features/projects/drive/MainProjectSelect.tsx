/**
 * Ангиллын төслийг үндсэн төсөлд харьяалуулах сонголт (admin).
 * Сонгомогц `PUT /main-projects/assign` — тусдаа «Хадгалах» шаардахгүй.
 * «— Харьяалалгүй —» = үндсэн төслөөс салгана.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { assignMainProject, fetchMainProjects, mainProjectsKey } from './api';
import type { MainProjectsResponse } from './types';

const NONE = '__none__';

export function MainProjectSelect({
  projectId,
  onChanged,
}: {
  projectId: number;
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery<MainProjectsResponse>({
    queryKey: mainProjectsKey,
    queryFn: fetchMainProjects,
    staleTime: 30_000,
  });
  const mains = q.data?.main_projects ?? [];
  const current = mains.find((m) => m.members.some((p) => p.id === projectId));

  const change = async (value: string) => {
    const next = value === NONE ? null : Number(value);
    if ((current?.id ?? null) === next) return;
    setBusy(true);
    try {
      await assignMainProject(projectId, next);
      await qc.invalidateQueries({ queryKey: ['project-drive'] });
      toast.success(next ? t('mainProject.assignedToast') : t('mainProject.unassignedToast'));
      await onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={current ? String(current.id) : NONE} onValueChange={(v) => void change(v)} disabled={busy}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t('mainProject.none')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('mainProject.none')}</SelectItem>
          {mains.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
    </div>
  );
}
