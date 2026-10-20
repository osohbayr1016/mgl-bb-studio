/* ---------- Multi-select Add Members dialog ----------
 * Extracted from `ProjectDetailPage.tsx` when that file was split into
 * per-component modules — no behavioural change. */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, UserPlus } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import type { User } from '@/shared/types';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';

import { AddMemberRow } from './AddMemberRow';

export function AddMembersDialog({
  projectId,
  existingMemberIds,
  onAdded,
}: {
  projectId: number;
  existingMemberIds: Set<number>;
  onAdded: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const usersQuery = useApiQuery<{ users: User[] }>('/users', { enabled: open, retry: false });
  const allUsers: User[] = usersQuery.data?.users ?? [];
  const loadingUsers = open && usersQuery.isLoading;

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch('');
    }
  }, [open]);

  /* Pool of users that can still be added (active + not already a member).
   *  Kept separate from `addable` (which is also search-filtered) so the
   *  team chips below count and select against the full pool, not just
   *  what's currently visible after a search. */
  const addablePool = useMemo(
    () => allUsers.filter((u) => u.status === 'active' && !existingMemberIds.has(u.id)),
    [allUsers, existingMemberIds],
  );

  const addable = useMemo(
    () =>
      addablePool.filter((u) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return (
          u.full_name.toLowerCase().includes(s) ||
          u.username.toLowerCase().includes(s) ||
          (u.position ?? '').toLowerCase().includes(s)
        );
      }),
    [addablePool, search],
  );

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const u of addable) next.add(u.id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/${projectId}/members`, {
        data: { user_ids: Array.from(selected) },
      });
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(t('common.error'), e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> {t('projectDetailPage.addMember')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('projectDetailPage.addMember')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('projectDetailPage.searchByNameOrDept')}
              className="pl-9"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              {loadingUsers
                ? t('projectDetailPage.loadingStaff')
                : t('projectDetailPage.userCount', { count: addable.length }) +
                  (selected.size > 0
                    ? ` · ${t('projectDetailPage.selectedCount', { count: selected.size })}`
                    : '')}
            </span>
            <div className="flex gap-2">
              <button
                onClick={selectAllVisible}
                disabled={addable.length === 0}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
              >
                {t('projectDetailPage.selectAll')}
              </button>
              <span className="text-border">|</span>
              <button
                onClick={clearSelection}
                disabled={selected.size === 0}
                className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {t('projectDetailPage.clearSelection')}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 space-y-1.5">
            {loadingUsers ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : addable.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">
                {t('projectDetailPage.noAddableUsers')}
              </div>
            ) : (
              addable.map((u) => (
                <AddMemberRow
                  key={u.id}
                  user={u}
                  selected={selected.has(u.id)}
                  onToggle={toggle}
                />
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('projectDetailPage.cancelAction')}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={saving || selected.size === 0}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4 mr-2" />
            )}
            {selected.size > 0
              ? t('projectDetailPage.addMembersCount', { count: selected.size })
              : t('projectDetailPage.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddMembersDialog;
