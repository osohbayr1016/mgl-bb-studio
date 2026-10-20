import { useEffect, useMemo, useState } from 'react';
import { useApiQuery } from '@/shared/api/useApi';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import type { User } from '@/shared/types';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Input } from '@/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import { Check, Crown, Loader2, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/components/Toast';
import { formatDisplayName } from '@/shared/lib/formatting';
import { initials } from '../lib/teamView';

/* ---------- AddTeamMembersDialog ----------
 * Admin-only dialog that lists every active user not already in this
 * team and lets the admin re-assign one or many of them in a single
 * call. Users are grouped by their *current* team so it's obvious
 * who you'd be poaching from. The dialog only fetches the users list
 * the first time it's opened — it's an admin-gated endpoint and the
 * payload can get sizeable, so on-demand keeps the team detail page
 * snappy for non-admins. */
export function AddTeamMembersDialog({
  teamId,
  teamName,
  existingMemberIds,
  open,
  onOpenChange,
  onAdded,
}: {
  teamId: number;
  teamName: string;
  existingMemberIds: Set<number>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAdded: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const usersQuery = useApiQuery<{ users: User[] }>('/users', { enabled: open, retry: false });
  const allUsers: User[] | null = usersQuery.data?.users ?? null;
  const loading = open && usersQuery.isLoading;

  useEffect(() => {
    if (!open) return;
    setError('');
    setSelected(new Set());
    setSearch('');
  }, [open]);

  useEffect(() => {
    if (usersQuery.error) {
      setError(usersQuery.error.message ?? t('teamDetailPage.listLoadFailed'));
    }
  }, [usersQuery.error, t]);

  /* Pool of candidates: active users who aren't already in this team.
   * We intentionally include people currently in *other* teams so the
   * admin can move them, but we badge their current team so the move
   * is explicit, not accidental. */
  const candidates = useMemo(() => {
    if (!allUsers) return [] as User[];
    return allUsers.filter((u) => u.status === 'active' && !existingMemberIds.has(u.id));
  }, [allUsers, existingMemberIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (u) =>
        u.full_name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.team_code ?? '').toLowerCase().includes(q) ||
        (u.team_name_mn ?? '').toLowerCase().includes(q) ||
        (u.position ?? '').toLowerCase().includes(q),
    );
  }, [candidates, search]);

  /* Group candidates by their *current* team so admins can scan
   * "who's in BA right now" and pull a chunk over. Users without a
   * team land in the synthetic "_none" bucket which is rendered last. */
  const grouped = useMemo(() => {
    const groups = new Map<string, { code: string; label: string; users: User[] }>();
    for (const u of filtered) {
      const key = u.team_code ?? '_none';
      const label = u.team_code
        ? `${u.team_code}${u.team_name_mn ? ` · ${u.team_name_mn}` : ''}`
        : t('teamDetailPage.noTeamGroup');
      if (!groups.has(key)) groups.set(key, { code: key, label, users: [] });
      groups.get(key)!.users.push(u);
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.code === '_none') return 1;
      if (b.code === '_none') return -1;
      return a.code.localeCompare(b.code);
    });
  }, [filtered, t]);

  const toggle = (uid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const toggleGroup = (users: User[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = users.every((u) => next.has(u.id));
      if (allOn) users.forEach((u) => next.delete(u.id));
      else users.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError('');
    const count = selected.size;
    try {
      await apiFetch(`/teams/${teamId}/members`, {
        method: 'POST',
        data: { user_ids: Array.from(selected) },
      });
      await onAdded();
      onOpenChange(false);
      toast.success(
        t('teamDetailPage.membersAdded', { count }),
        t('teamDetailPage.membersAddedDetail', { team: teamName }),
      );
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : t('common.saveFailed');
      setError(msg);
      toast.error(t('teamDetailPage.addMemberFailed'), msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 gap-1.5 px-2.5 text-micro shadow-sm shadow-primary/20 pointer-coarse:h-9">
          <UserPlus className="size-3.5" /> {t('teamDetailPage.addMember')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            {t('teamDetailPage.addMember')}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{teamName}</span>{' '}
            {t('teamDetailPage.addMemberDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('teamDetailPage.searchMembersPlaceholder')}
              className="pl-9"
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs p-2.5">
              {error}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border/60 bg-muted/10">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : grouped.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {search
                  ? t('teamDetailPage.noMatchingEmployee')
                  : t('teamDetailPage.noEmployeeToAdd')}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {grouped.map((g) => {
                  const allOn = g.users.every((u) => selected.has(u.id));
                  const someOn = !allOn && g.users.some((u) => selected.has(u.id));
                  return (
                    <div key={g.code}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(g.users)}
                        className={cn(
                          'sticky top-0 z-10 w-full flex items-center justify-between px-3 py-1.5 text-label font-semibold bg-card/95 backdrop-blur border-b border-border/40 hover:bg-muted/50 transition-colors',
                          g.code === '_none' ? 'text-muted-foreground' : 'text-primary',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span>{g.label}</span>
                          <Badge variant="outline" className="text-micro py-0 h-4 font-normal">
                            {g.users.length}
                          </Badge>
                        </span>
                        <span
                          className={cn(
                            'h-4 w-4 rounded border flex items-center justify-center transition-colors',
                            allOn
                              ? 'bg-primary border-primary text-primary-foreground'
                              : someOn
                                ? 'bg-primary/30 border-primary/60'
                                : 'border-border bg-background',
                          )}
                        >
                          {allOn && <Check className="h-3 w-3" />}
                          {someOn && <span className="h-1.5 w-1.5 bg-primary rounded-sm" />}
                        </span>
                      </button>
                      <div>
                        {g.users.map((u) => {
                          const checked = selected.has(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => toggle(u.id)}
                              className={cn(
                                'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors',
                                checked && 'bg-primary/5',
                              )}
                            >
                              <span
                                className={cn(
                                  'h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                                  checked
                                    ? 'bg-primary border-primary text-primary-foreground'
                                    : 'border-border bg-background',
                                )}
                              >
                                {checked && <Check className="h-3 w-3" />}
                              </span>
                              <Avatar className="h-7 w-7 flex-shrink-0">
                                {u.profile_image && (
                                  <AvatarImage
                                    src={`${MEDIA_BASE_URL}${u.profile_image}`}
                                    alt={formatDisplayName(u.full_name)}
                                  />
                                )}
                                <AvatarFallback className="bg-primary/15 text-primary text-micro">
                                  {initials(formatDisplayName(u.full_name))}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                                  {formatDisplayName(u.full_name)}
                                  {u.role === 'admin' && (
                                    <Crown className="h-3 w-3 text-warning shrink-0" />
                                  )}
                                  {u.role === 'senior' && (
                                    <ShieldCheck className="h-3 w-3 text-warning shrink-0" />
                                  )}
                                </div>
                                <div className="text-micro text-muted-foreground truncate">
                                  {u.position || u.role}
                                  {u.employee_id && (
                                    <span className="ml-1.5 font-mono">· {u.employee_id}</span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{selected.size}</span>{' '}
              {t('teamDetailPage.selectedOfAvailable', { available: candidates.length })}
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" /> {t('teamDetailPage.clearSelection')}
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={selected.size === 0 || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <UserPlus className="h-4 w-4 mr-1.5" />
            {selected.size > 0
              ? t('teamDetailPage.addNMembers', { count: selected.size })
              : t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
