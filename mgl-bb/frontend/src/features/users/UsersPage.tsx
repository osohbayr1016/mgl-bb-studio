import { useMemo, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { useApiQuery } from '@/shared/api/useApi';
import type { User, UserRole, Team, Seniority } from '@/shared/types';

/** `GET /users/:id/devices` мөр (routes/users.ts). */
interface AttendanceDeviceRow {
  id: number;
  browser: string;
  bound_via: 'first' | 'hw_match' | 'legacy';
  bound_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  hw_group: string | null;
  gpu: string | null;
  screen: string | null;
  cores: number | null;
}
import { SENIORITY_OPTIONS, seniorityFullLabel } from '@/shared/types';
import { shiftOptions, type ScheduleKey } from '@/features/attendance/shifts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';
import {
  Users as UsersIcon,
  Shield,
  ShieldCheck,
  Clock,
  Loader2,
  AlertCircle,
  UserPlus,
  Search,
  Building2,
  Edit3,
  KeyRound,
  MonitorSmartphone,
  Smartphone,
  Globe,
  Power,
  Sparkles,
  ClipboardCheck,
} from 'lucide-react';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { PgpAuthorsList } from '@/features/pgp';
import { RevitLicenseDevices } from './components/RevitLicenseDevices';
import { AssessmentsAdminTab } from '@/features/assessments/admin/AssessmentsAdminTab';
import { useAuth } from '@/shared/context/AuthContext';
import { Navigate, useNavigate } from 'react-router-dom';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { teamChipClass } from '@/shared/lib/team-colors';
import { roleBadgeTone } from '@/shared/lib/status-colors';
import { cn } from '@/shared/lib/utils';
import { useTabParam } from '@/shared/hooks/useTabParam';

import { formatDate } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import { rankUsers } from '@/shared/lib/search/rankUsers';
import { useLanguage, type TranslationKey } from '@/shared/i18n';
import { roleLabelKey } from '@/shared/lib/roles';

// Шошго нь `shared/lib/roles.ts`-ийн ГЛОБАЛ `role_*` түлхүүрүүд — профайл,
// хянах самбар, журам/мэдээллийн roster бүгд ижил үгээр нэрлэнэ.
const ROLES: { value: UserRole; labelKey: TranslationKey }[] = [
  { value: 'engineer', labelKey: roleLabelKey('engineer') },
  { value: 'architect', labelKey: roleLabelKey('architect') },
  { value: 'senior', labelKey: roleLabelKey('senior') },
  { value: 'admin', labelKey: roleLabelKey('admin') },
  { value: 'client', labelKey: roleLabelKey('client') },
  // Цэвэрлэгч / туслах ажилтан — зөвхөн ирцээ бүртгэдэг (утаснаас, ажлын
  // Wi-Fi дээр).  Төсөл, баг, бүтээмжийн самбарт огт хандахгүй.
  { value: 'worker', labelKey: roleLabelKey('worker') },
];

const SENIORITY_BADGE: Record<Seniority, string> = {
  senior: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  intermediate: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  junior: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  intern: 'bg-muted text-muted-foreground border-border',
};

const TEAM_ANY = 'all';
const TEAM_NONE = 'none';

/** Табны утгууд нь глобал хайлтын гүн холбоосын бай (`?tab=…`) — эдгээрийг
 *  `frontend/src/shared/lib/search/sections.ts` давхар тусгасан тул нэрийг
 *  солих бол хоёуланг нь зэрэг солино. */
const USERS_TABS = ['staff', 'pgp', 'assessments'] as const;
type UsersTab = (typeof USERS_TABS)[number];

export default function UsersPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const usersQuery = useApiQuery<{ users: User[] }>('/users');
  const teamsQuery = useApiQuery<{ teams: Team[] }>('/teams');
  // Lightweight project list used by the "Захиалагч нэмэх" dialog so the
  // admin can link the client to one or more projects in a single step
  // instead of jumping to each project page afterwards.
  const projectsQuery = useApiQuery<{ projects: Array<{ id: number; name: string }> }>(
    '/projects',
    { retry: false },
  );
  const usersList: User[] = usersQuery.data?.users ?? [];
  const teams: Team[] = teamsQuery.data?.teams ?? [];
  const projects: Array<{ id: number; name: string }> = projectsQuery.data?.projects ?? [];
  const loading = usersQuery.isLoading || teamsQuery.isLoading;

  // Imperative refresh shim for mutation handlers below.
  const fetchAll = async () => {
    await Promise.all([usersQuery.refetch(), teamsQuery.refetch(), projectsQuery.refetch()]);
  };

  const [tab, setTab] = useTabParam(USERS_TABS, 'staff', 'tab');

  // Filters
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>(TEAM_ANY);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Create user dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  // Whether the dialog was opened via the dedicated "Захиалагч нэмэх" (add
  // client) button.  A client has no employee ID / role / team / position, so
  // in this mode we collapse the form to just login + project linker and lock
  // the role to 'client' (the role selector is hidden entirely).
  const [clientMode, setClientMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'engineer' as UserRole,
    team_id: null as number | null,
    position: '',
    employee_id: '',
    seniority: '' as Seniority | '',
    is_support: false,
  });
  // Projects to attach the new user to.  Only relevant when role==='client'
  // — for engineers/admins/etc. we leave the picker hidden and ignore this
  // set on submit.
  const [linkProjectIds, setLinkProjectIds] = useState<Set<number>>(new Set());

  // Edit user dialog (username/team/position/role)
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{
    username: string;
    team_ids: Array<{ team_id: number; is_primary: number }>;
    position: string;
    role: UserRole;
    seniority: Seniority | '';
    is_support: boolean;
    /** Ажлын ээлж — `user_work_schedules` руу МАРГААШААС хүчинтэй мөр болж
     *  бичигдэнэ (`users.work_schedule` баганад БИШ, миграци 0199). */
    work_schedule: ScheduleKey;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Reset password dialog
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  // Reset attendance device dialog
  const [resetDeviceTarget, setResetDeviceTarget] = useState<User | null>(null);
  const [resetDeviceSaving, setResetDeviceSaving] = useState(false);
  // Холбогдсон браузер/төхөөрөмжийн жагсаалт (0328) — dialog нээгдмэгц л татна.
  const devicesQuery = useApiQuery<{ devices: AttendanceDeviceRow[] }>(
    ['user-devices', resetDeviceTarget?.id ?? 0],
    `/users/${resetDeviceTarget?.id ?? 0}/devices`,
    { enabled: !!resetDeviceTarget },
  );
  /** «· 2 браузер» — нэг компьютерийн олон браузер холбогдсон бол. */
  const deviceCountSuffix = (u: User): string =>
    (u.attendance_device_count ?? 0) > 1
      ? ` · ${t('usersPage.deviceBrowsers', { n: u.attendance_device_count ?? 0 })}`
      : '';

  // `fetchAll` is declared above as a thin shim over the three
  // useApiQuery refetches; legacy mutation handlers still call it.

  // A client (захиалагч) has no employee ID / team / position / seniority, so
  // the add-user dialog hides those fields.  True either when the dialog was
  // opened via the dedicated "Захиалагч нэмэх" button (`clientMode`) or when
  // the admin picks the Захиалагч role from the generic add-user form.
  const isClientCreate = clientMode || newUser.role === 'client';

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newUser.username || !newUser.password || !newUser.full_name) {
      setError(t('usersPage.fillRequiredFields'));
      return;
    }
    if (newUser.password.length < 6) {
      setError(t('usersPage.passwordMin'));
      return;
    }

    setCreating(true);
    try {
      // 1) Create the user.  The backend returns the new id under
      //    `user.id`; we capture it so we can immediately link the
      //    fresh client to the projects the admin selected without
      //    requiring a second visit to each project page.
      // A client has no employee ID / position / team / seniority / support
      // flag — force them empty so nothing stale from a role switch leaks
      // through, regardless of how the dialog was opened.
      const isClientUser = newUser.role === 'client';
      const created = await apiFetch<{ user: { id: number } }>('/users', {
        method: 'POST',
        data: {
          ...newUser,
          employee_id: isClientUser ? undefined : newUser.employee_id.trim() || undefined,
          position: isClientUser ? undefined : newUser.position.trim() || undefined,
          team_id: isClientUser ? undefined : (newUser.team_id ?? undefined),
          seniority: isClientUser ? null : newUser.seniority || null,
          is_support: isClientUser ? false : newUser.is_support,
        },
      });

      // 2) Link to projects.  Only meaningful for clients (the picker is
      //    hidden for other roles, so the set will be empty).  We post
      //    one batch per project rather than risking the membership
      //    endpoint silently rejecting a mixed batch.
      const newUserId = created?.user?.id;
      if (newUserId && newUser.role === 'client' && linkProjectIds.size > 0) {
        await Promise.all(
          Array.from(linkProjectIds).map((pid) =>
            apiFetch(`/projects/${pid}/members`, {
              data: { user_ids: [newUserId] },
            }).catch((err) => {
              // Don't abort the whole flow on a partial linking failure
              // — the user is created either way.  We surface the issue
              // in the dialog so the admin can retry from the project
              // page if needed.
              console.error('Link to project failed', pid, err);
            }),
          ),
        );
      }

      setDialogOpen(false);
      setNewUser({
        username: '',
        password: '',
        full_name: '',
        role: 'engineer',
        team_id: null,
        position: '',
        employee_id: '',
        seniority: '',
        is_support: false,
      });
      setLinkProjectIds(new Set());
      fetchAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('usersPage.createUserError');
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (usr: User) => {
    const next = usr.status === 'active' ? 'inactive' : 'active';
    try {
      await apiFetch(`/users/${usr.id}/status`, {
        method: 'PATCH',
        data: { status: next },
      });
      toast.success(
        next === 'inactive'
          ? t('usersPage.userDeactivated', { name: formatDisplayName(usr.full_name) })
          : t('usersPage.userActivated', { name: formatDisplayName(usr.full_name) }),
      );
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error(t('usersPage.statusChangeFailed'), err instanceof Error ? err.message : undefined);
    }
  };

  // Утаснаас ирц бүртгэхийг зөвшөөрөх/хаах (ирцийн бүх хязгаарлалтаас чөлөөлөх).
  const handleToggleAttendanceAccess = async (usr: User) => {
    const next = !usr.attendance_unrestricted;
    try {
      await apiFetch(`/users/${usr.id}/attendance-access`, {
        method: 'PATCH',
        data: { unrestricted: next },
      });
      toast.success(
        next
          ? t('usersPage.phoneAttendanceAllowed', { name: formatDisplayName(usr.full_name) })
          : t('usersPage.phoneAttendanceBlocked', { name: formatDisplayName(usr.full_name) }),
      );
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error(t('usersPage.changeFailed'), err instanceof Error ? err.message : undefined);
    }
  };

  const handleToggleRemoteAccess = async (usr: User) => {
    const next = !usr.remote_access_allowed;
    try {
      await apiFetch(`/users/${usr.id}/remote-access`, {
        method: 'PATCH',
        data: { remote: next },
      });
      toast.success(
        next
          ? t('usersPage.remoteAccessAllowed', { name: formatDisplayName(usr.full_name) })
          : t('usersPage.remoteAccessBlocked', { name: formatDisplayName(usr.full_name) }),
      );
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error(t('usersPage.changeFailed'), err instanceof Error ? err.message : undefined);
    }
  };

  const openEdit = (usr: User) => {
    setEditTarget(usr);
    const teamIds: Array<{ team_id: number; is_primary: number }> = usr.teams?.length
      ? usr.teams.map((t) => ({ team_id: t.id, is_primary: t.is_primary }))
      : usr.team_id
        ? [{ team_id: usr.team_id, is_primary: 1 }]
        : [];
    setEditForm({
      username: usr.username ?? '',
      team_ids: teamIds,
      position: usr.position ?? '',
      role: usr.role,
      seniority: (usr.seniority ?? '') as Seniority | '',
      is_support: usr.is_support === 1,
      // Сонголт (`work_schedule_selected`) — зуны албадлагаар дарагдсан
      // бодит ээлж БИШ.  Backend хоёуланг нь буцаадаг.
      work_schedule: usr.work_schedule_selected ?? usr.work_schedule ?? 'standard',
    });
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editForm) return;
    const trimmedUsername = editForm.username.trim();
    if (!trimmedUsername) {
      setError(t('usersPage.usernameEmpty'));
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(trimmedUsername)) {
      setError(t('usersPage.usernameInvalid'));
      return;
    }
    setError('');
    setEditSaving(true);
    try {
      const payload: Record<string, unknown> = {
        team_ids: editForm.team_ids,
        position: editForm.position.trim() || null,
        role: editForm.role,
        seniority: editForm.seniority || null,
        is_support: editForm.is_support,
      };
      if (!editTarget.schedule_fixed) {
        payload.work_schedule = editForm.work_schedule;
      }
      if (trimmedUsername !== (editTarget.username ?? '')) {
        payload.username = trimmedUsername;
      }
      await apiFetch(`/users/${editTarget.id}`, {
        method: 'PUT',
        data: payload,
      });
      setEditTarget(null);
      setEditForm(null);
      fetchAll();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : t('usersPage.saveError');
      setError(msg);
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget || resetPwd.length < 6) return;
    setResetSaving(true);
    try {
      await apiFetch(`/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        data: { new_password: resetPwd },
      });
      setResetTarget(null);
      setResetPwd('');
    } catch (err) {
      console.error(err);
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setResetSaving(false);
    }
  };

  // Ирцийн төхөөрөмжийн холболтыг цэвэрлэх — хэрэглэгч дараагийн clock-in-д
  // шинэ PC-д холбогдоно (PC солих / storage цэвэрлэгдсэн тохиолдолд).
  const handleResetDevice = async () => {
    if (!resetDeviceTarget) return;
    setResetDeviceSaving(true);
    try {
      await apiFetch(`/users/${resetDeviceTarget.id}/reset-device`, { method: 'POST' });
      toast.success(t('usersPage.deviceCleared'));
      setResetDeviceTarget(null);
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error(t('usersPage.clearFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setResetDeviceSaving(false);
    }
  };

  const getRoleLabel = (role: string) => {
    const entry = ROLES.find((r) => r.value === role);
    return entry ? t(entry.labelKey) : role;
  };

  const filtered = useMemo(() => {
    const prefiltered = usersList.filter((u) => {
      const teamCount = u.teams?.length ?? (u.team_id != null ? 1 : 0);
      if (teamFilter === TEAM_NONE && teamCount > 0) return false;
      if (teamFilter !== TEAM_ANY && teamFilter !== TEAM_NONE) {
        const inTeam = u.teams?.length
          ? u.teams.some((t) => String(t.id) === teamFilter)
          : String(u.team_id ?? '') === teamFilter;
        if (!inTeam) return false;
      }
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      return true;
    });
    // Хайлт — кирилл↔латин фолд, нэр/баг/албан тушаал/код, хамаарлаар эрэмбэлсэн
    // (`shared/lib/search/rankUsers.ts`, Тайлан хуудасны сонгогчтой нэг хөдөлгүүр).
    // Урьд нь `includes()` байсан тул «bat» гэж бичихэд «Бат» олддоггүй байв.
    if (!search.trim()) return prefiltered;
    return rankUsers(prefiltered, search, Number.POSITIVE_INFINITY);
  }, [usersList, search, teamFilter, roleFilter, statusFilter]);

  // Админ биш бол хаана — hook-ууд бүгд дуудагдсаны дараа шалгана
  // (rules-of-hooks: early return нь hook-уудын өмнө байж болохгүй).
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <PageContainer className="pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <UsersIcon className="h-6 w-6 shrink-0 text-primary" />
            {t('usersPage.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('usersPage.subtitle')}
          </p>
        </div>

        {tab === 'staff' && (
        <div className="flex items-center gap-2">
          {/* Convenience CTA — opens the same Create-user dialog but
              pre-selects role=client so admins can quickly provision a
              project owner login.  After creation, the admin still has
              to attach this client to a project from the Project page
              (Activity tab → "Гишүүн нэмэх"). */}
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => {
              setNewUser({
                username: '',
                password: '',
                full_name: '',
                role: 'client',
                team_id: null,
                position: '',
                employee_id: '',
                seniority: '',
                is_support: false,
              });
              setClientMode(true);
              setError('');
              // Start with no projects selected — admin must explicitly
              // pick which project(s) the client should see.
              setLinkProjectIds(new Set());
              setDialogOpen(true);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" /> {t('usersPage.addClient')}
          </Button>
          <Button
            className="shrink-0 shadow-lg shadow-primary/20"
            onClick={() => {
              setNewUser({
                username: '',
                password: '',
                full_name: '',
                role: 'engineer',
                team_id: null,
                position: '',
                employee_id: '',
                seniority: '',
                is_support: false,
              });
              setClientMode(false);
              setLinkProjectIds(new Set());
              setError('');
              setDialogOpen(true);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" /> {t('usersPage.addUser')}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-[520px] border-border bg-card/95 backdrop-blur-xl">
              <DialogHeader>
                <DialogTitle>
                  {clientMode ? t('usersPage.newClient') : t('usersPage.newUser')}
                </DialogTitle>
                <DialogDescription>
                  {clientMode ? t('usersPage.newClientDesc') : t('usersPage.newUserDesc')}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateUser} className="space-y-4 pt-2">
                {error && (
                  <div className="rounded-md bg-destructive/15 p-3 flex items-center text-destructive text-sm border border-destructive/20">
                    <AlertCircle className="w-4 h-4 mr-2 shrink-0" /> {error}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-2">
                    <Label>{t('usersPage.fullName')}</Label>
                    <Input
                      placeholder="Бат-Өлзий Билгүүн"
                      value={newUser.full_name}
                      onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('usersPage.username')}</Label>
                    <Input
                      placeholder="bln"
                      value={newUser.username}
                      onChange={(e) =>
                        setNewUser({
                          ...newUser,
                          username: e.target.value.toLowerCase().replace(/\s/g, ''),
                        })
                      }
                      required
                    />
                  </div>
                  {!isClientCreate && (
                    <div className="space-y-2">
                      <Label>{t('usersPage.employeeId')}</Label>
                      <Input
                        placeholder="BLN"
                        value={newUser.employee_id}
                        onChange={(e) =>
                          setNewUser({
                            ...newUser,
                            employee_id: e.target.value.toUpperCase().replace(/\s/g, ''),
                          })
                        }
                        className="font-mono"
                        maxLength={8}
                      />
                    </div>
                  )}
                  <div className="col-span-2 space-y-2">
                    <Label>{t('usersPage.password')}</Label>
                    <Input
                      type="password"
                      placeholder={t('usersPage.passwordPlaceholder')}
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      required
                    />
                  </div>
                  {!clientMode && (
                    <div className="space-y-2">
                      <Label>{t('usersPage.roleLabel')}</Label>
                      <Select
                        value={newUser.role}
                        onValueChange={(val) => setNewUser({ ...newUser, role: val as UserRole })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {t(r.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {!isClientCreate && (
                    <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
                      <Checkbox
                        checked={newUser.is_support}
                        onCheckedChange={(c) => setNewUser({ ...newUser, is_support: c === true })}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-muted-foreground">
                        {t('usersPage.supportStaffDesc')}
                      </span>
                    </label>
                  )}
                  {!isClientCreate && (
                    <div className="space-y-2">
                      <Label>{t('usersPage.team')}</Label>
                      <Select
                        value={newUser.team_id == null ? '' : String(newUser.team_id)}
                        onValueChange={(val) =>
                          setNewUser({ ...newUser, team_id: val ? Number(val) : null })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('usersPage.selectPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {teams.map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.code} — {t.name_mn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {!isClientCreate && (
                    <div className="space-y-2">
                      <Label>{t('usersPage.position')}</Label>
                      <Input
                        placeholder={t('usersPage.positionPlaceholder')}
                        value={newUser.position}
                        onChange={(e) => setNewUser({ ...newUser, position: e.target.value })}
                      />
                    </div>
                  )}
                  {!isClientCreate && (
                    <div className="space-y-2">
                      <Label>{t('usersPage.seniority')}</Label>
                      <Select
                        value={newUser.seniority || 'none'}
                        onValueChange={(v) =>
                          setNewUser({
                            ...newUser,
                            seniority: v === 'none' ? '' : (v as Seniority),
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('usersPage.selectPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('usersPage.seniorityNone')}</SelectItem>
                          {SENIORITY_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label_mn}{' '}
                              <span className="text-muted-foreground">· {s.label_en}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {newUser.seniority && (
                        <p className="text-micro text-muted-foreground">
                          {t('usersPage.track')}{' '}
                          <span className="font-medium text-foreground">
                            {seniorityFullLabel(
                              newUser.seniority as Seniority,
                              teams.find((t) => t.id === newUser.team_id)?.code ?? null,
                            )}
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Project linker — only relevant for clients.  Without
                    a project the client would land on an empty
                    dashboard, so we show an inline checklist of every
                    project so the admin can attach 1+ in the same
                    step that creates the login. */}
                  {newUser.role === 'client' && (
                    <div className="col-span-2 space-y-2">
                      <Label className="flex items-center justify-between">
                        <span>{t('usersPage.linkProject')}</span>
                        <span className="text-micro text-muted-foreground font-normal">
                          {t('usersPage.linkProjectHint')}
                        </span>
                      </Label>
                      {projects.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                          {t('usersPage.noProjectsYet')}
                        </div>
                      ) : (
                        <div className="rounded-md border border-border/60 max-h-44 overflow-y-auto divide-y divide-border/60">
                          {projects.map((p) => {
                            const checked = linkProjectIds.has(p.id);
                            return (
                              <label
                                key={p.id}
                                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(value) => {
                                    setLinkProjectIds((prev) => {
                                      const next = new Set(prev);
                                      if (value === true) next.add(p.id);
                                      else next.delete(p.id);
                                      return next;
                                    });
                                  }}
                                />
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="flex-1 truncate">{p.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div className="text-micro text-muted-foreground">
                        {t('usersPage.selectedProjects', { count: linkProjectIds.size })}
                        {linkProjectIds.size === 0 && (
                          <span className="ml-1 text-warning">
                            {t('usersPage.noProjectSelectedWarn')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('common.create')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        )}
      </div>

      <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as UsersTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="staff" className="flex-1 gap-2">
            <UsersIcon className="h-4 w-4" />
            {t('usersPage.tabStaff')}
          </TabsTrigger>
          <TabsTrigger value="pgp" className="flex-1 gap-2">
            <Sparkles className="h-4 w-4" />
            {t('pgpAuthors.tab')}
          </TabsTrigger>
          <TabsTrigger value="assessments" className="flex-1 gap-2">
            <ClipboardCheck className="h-4 w-4" />
            {t('assessments.navTitle')}
          </TabsTrigger>
        </TabsList>

        <KeepAliveTabsPanel value="staff" className="mt-4 space-y-6">
      {/* Stats */}
      <div id="sec-users-stats" className="grid grid-cols-2 md:grid-cols-4 gap-3 scroll-mt-24">
        {[
          { labelKey: 'usersPage.statTotal' as TranslationKey, value: usersList.length, color: 'text-primary' },
          {
            labelKey: 'usersPage.statActive' as TranslationKey,
            value: usersList.filter((u) => u.status === 'active').length,
            color: 'text-success',
          },
          {
            labelKey: 'usersPage.statUnassigned' as TranslationKey,
            value: usersList.filter((u) => !u.team_id).length,
            color: 'text-warning',
          },
          {
            labelKey: 'usersPage.statAdmin' as TranslationKey,
            value: usersList.filter((u) => u.role === 'admin').length,
            color: 'text-destructive',
          },
        ].map((s) => (
          <Card key={s.labelKey} className="border-border bg-card/60 backdrop-blur">
            <CardContent className="p-4">
              <p className={`text-2xl font-bold ${s.color}`}>{loading ? '—' : s.value}</p>
              <p className="text-xs text-muted-foreground">{t(s.labelKey)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card id="sec-users-table" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
        <CardHeader className="pb-3">
          <CardTitle>{t('usersPage.staff')}</CardTitle>
          <CardDescription>{t('usersPage.staffDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('usersPage.searchPlaceholder')}
                aria-label={t('common.search')}
                className="pl-9"
              />
            </div>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="md:w-[220px]">
                <Building2 className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TEAM_ANY}>{t('usersPage.allTeams')}</SelectItem>
                <SelectItem value={TEAM_NONE}>{t('usersPage.noTeam')}</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.code} — {t.name_mn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="md:w-[160px]">
                <Shield className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('usersPage.allRoles')}</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}
            >
              <SelectTrigger className="md:w-[160px]">
                <Power className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('usersPage.allStatuses')}</SelectItem>
                <SelectItem value="active">{t('usersPage.statusActive')}</SelectItem>
                <SelectItem value="inactive">{t('usersPage.statusInactive')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile card list — desktop хэвээр хүснэгтээр харагдана. */}
          <div className="md:hidden flex flex-col gap-2">
            {loading ? (
              <div className="rounded-md border border-border p-6 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
                {t('usersPage.noUsersFound')}
              </div>
            ) : (
              filtered.map((usr) => {
                const initials = formatDisplayName(usr.full_name).substring(0, 2).toUpperCase();
                return (
                  <div
                    key={usr.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      navigate(usr.id === user?.id ? '/app/profile' : `/app/users/${usr.id}`)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(usr.id === user?.id ? '/app/profile' : `/app/users/${usr.id}`);
                      }
                    }}
                    className="rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40 cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10 flex-shrink-0">
                        {usr.profile_image && (
                          <AvatarImage
                            src={`${MEDIA_BASE_URL}${usr.profile_image}`}
                            alt={formatDisplayName(usr.full_name)}
                          />
                        )}
                        <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground truncate">
                            {formatDisplayName(usr.full_name)}
                          </span>
                          <div
                            className={cn(
                              'h-2 w-2 rounded-full flex-shrink-0',
                              usr.status === 'active' ? 'bg-success' : 'bg-destructive',
                            )}
                            title={usr.status === 'active' ? t('usersPage.statusActive') : t('usersPage.statusInactive')}
                          />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {usr.employee_id ?? `ID: ${usr.id.toString().padStart(4, '0')}`}
                          </span>
                          <span>·</span>
                          <span className="font-mono">{usr.username}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn('capitalize text-micro', roleBadgeTone(usr.role))}
                          >
                            {usr.role === 'admin' ? (
                              <ShieldCheck className="h-3 w-3 mr-1" />
                            ) : (
                              <Shield className="h-3 w-3 mr-1" />
                            )}
                            {getRoleLabel(usr.role)}
                          </Badge>
                          {usr.team_code ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                'font-mono text-micro px-1.5 py-0',
                                teamChipClass(usr.team_code),
                              )}
                            >
                              {usr.team_code} · {usr.team_name_mn}
                            </Badge>
                          ) : (
                            <span className="text-micro italic text-muted-foreground">
                              {t('usersPage.noTeamAssigned')}
                            </span>
                          )}
                          {usr.seniority && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-micro px-1.5 py-0',
                                SENIORITY_BADGE[usr.seniority],
                              )}
                            >
                              {seniorityFullLabel(usr.seniority, usr.team_code ?? null)}
                            </Badge>
                          )}
                          {usr.is_support === 1 && (
                            <Badge
                              variant="outline"
                              className="text-micro px-1.5 py-0 bg-slate-500/10 text-slate-500 border-slate-500/20"
                              title={t('usersPage.supportBadgeTooltip')}
                            >
                              {t('usersPage.supportBadge')}
                            </Badge>
                          )}
                        </div>
                        {usr.position && (
                          <p className="mt-1 text-xs text-muted-foreground truncate">
                            {usr.position}
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => openEdit(usr)}
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1" />
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => setResetTarget(usr)}
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1" />
                        {t('usersPage.passwordShort')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        disabled={!usr.attendance_device_id && user?.role !== 'admin'}
                        title={
                          usr.attendance_device_id
                            ? `${t('usersPage.deviceBound')}${usr.attendance_device_bound_at ? ` · ${formatDate(usr.attendance_device_bound_at)}` : ''}${deviceCountSuffix(usr)}`
                            : t('usersPage.deviceNotBound')
                        }
                        onClick={() => setResetDeviceTarget(usr)}
                      >
                        <MonitorSmartphone className="h-3.5 w-3.5 mr-1" />
                        {t('usersPage.device')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn(
                          'h-8 px-2 text-xs',
                          usr.attendance_unrestricted && 'text-success',
                        )}
                        title={
                          usr.attendance_unrestricted
                            ? t('usersPage.phoneAttendanceOnTooltip')
                            : t('usersPage.phoneAttendanceOffTooltip')
                        }
                        onClick={() => handleToggleAttendanceAccess(usr)}
                      >
                        <Smartphone className="h-3.5 w-3.5 mr-1" />
                        {usr.attendance_unrestricted ? t('usersPage.phoneOn') : t('usersPage.phone')}
                      </Button>
                      {usr.role !== 'client' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={cn(
                            'h-8 px-2 text-xs',
                            usr.remote_access_allowed && 'text-success',
                          )}
                          title={
                            usr.remote_access_allowed
                              ? t('usersPage.remoteAccessOnTooltip')
                              : t('usersPage.remoteAccessOffTooltip')
                          }
                          onClick={() => handleToggleRemoteAccess(usr)}
                        >
                          <Globe className="h-3.5 w-3.5 mr-1" />
                          {usr.remote_access_allowed ? t('usersPage.remoteOn') : t('usersPage.remote')}
                        </Button>
                      )}
                      {usr.id !== user?.id && (
                        <Button
                          size="sm"
                          variant={usr.status === 'active' ? 'outline' : 'default'}
                          className="h-8 px-2 text-xs"
                          onClick={() => handleToggleStatus(usr)}
                        >
                          {usr.status === 'active' ? t('usersPage.deactivate') : t('usersPage.activate')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden md:block rounded-md border border-border overflow-hidden">
            <Table className="table-fixed w-full">
              <TableHeader className="bg-secondary/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[24%]">{t('usersPage.colEmployee')}</TableHead>
                  <TableHead className="w-[27%]">{t('usersPage.colTeamPosition')}</TableHead>
                  <TableHead className="w-[12%]">{t('usersPage.colRole')}</TableHead>
                  <TableHead className="w-[11%]">{t('usersPage.colStatus')}</TableHead>
                  <TableHead className="w-[11%]">{t('usersPage.colRegistered')}</TableHead>
                  <TableHead className="w-[15%] text-right">{t('usersPage.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {t('usersPage.noUsersFound')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((usr) => (
                    <TableRow
                      key={usr.id}
                      className="hover:bg-muted/40 border-border cursor-pointer"
                      onClick={() =>
                        navigate(usr.id === user?.id ? '/app/profile' : `/app/users/${usr.id}`)
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            {usr.profile_image && (
                              <AvatarImage
                                src={`${MEDIA_BASE_URL}${usr.profile_image}`}
                                alt={formatDisplayName(usr.full_name)}
                              />
                            )}
                            <AvatarFallback className="bg-primary/20 text-primary text-xs">
                              {formatDisplayName(usr.full_name).substring(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-foreground truncate hover:text-primary transition-colors">
                              {formatDisplayName(usr.full_name)}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono truncate">
                              {usr.employee_id ?? `ID:${usr.id.toString().padStart(4, '0')}`}
                              <span className="text-muted-subtle"> · @{usr.username}</span>
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {usr.team_code ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'font-mono text-micro px-1.5 py-0',
                                  teamChipClass(usr.team_code),
                                )}
                              >
                                {usr.team_code}
                              </Badge>
                              <span className="text-sm text-foreground truncate">
                                {usr.team_name_mn}
                              </span>
                              {usr.seniority && (
                                <Badge
                                  variant="outline"
                                  className={`text-micro px-1.5 py-0 ${SENIORITY_BADGE[usr.seniority]}`}
                                >
                                  {seniorityFullLabel(usr.seniority, usr.team_code)}
                                </Badge>
                              )}
                            </div>
                            {usr.position && (
                              <span className="text-xs text-muted-foreground truncate">
                                {usr.position}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground italic">
                              {t('usersPage.noTeamAssignedDashed')}
                            </span>
                            {usr.seniority && (
                              <Badge
                                variant="outline"
                                className={`text-micro px-1.5 py-0 w-fit ${SENIORITY_BADGE[usr.seniority]}`}
                              >
                                {seniorityFullLabel(usr.seniority, null)}
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize font-medium ${roleBadgeTone(usr.role)}`}
                        >
                          {usr.role === 'admin' ? (
                            <ShieldCheck className="h-3 w-3 mr-1" />
                          ) : (
                            <Shield className="h-3 w-3 mr-1" />
                          )}
                          {getRoleLabel(usr.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-2 w-2 rounded-full ${usr.status === 'active' ? 'bg-success' : 'bg-destructive'}`}
                          />
                          <span className="text-sm font-medium">
                            {usr.status === 'active' ? t('usersPage.statusActive') : t('usersPage.statusInactive')}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          {formatDate(new Date(usr.created_at))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => openEdit(usr)}
                            title={t('common.edit')}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => setResetTarget(usr)}
                            title={t('usersPage.resetPassword')}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(
                              'h-8 w-8 p-0',
                              usr.attendance_device_id && 'text-success',
                            )}
                            disabled={!usr.attendance_device_id && user?.role !== 'admin'}
                            onClick={() => setResetDeviceTarget(usr)}
                            title={
                              usr.attendance_device_id
                                ? `${t('usersPage.deviceBound')}${usr.attendance_device_bound_at ? ` · ${formatDate(usr.attendance_device_bound_at)}` : ''}${deviceCountSuffix(usr)} — ${t('usersPage.resetWord')}`
                                : t('usersPage.deviceNotBound')
                            }
                          >
                            <MonitorSmartphone className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(
                              'h-8 w-8 p-0',
                              usr.attendance_unrestricted && 'text-success',
                            )}
                            onClick={() => handleToggleAttendanceAccess(usr)}
                            title={
                              usr.attendance_unrestricted
                                ? t('usersPage.phoneAttendanceOnTooltipShort')
                                : t('usersPage.phoneAttendanceOffTooltipShort')
                            }
                          >
                            <Smartphone className="h-3.5 w-3.5" />
                          </Button>
                          {usr.role !== 'client' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn(
                                'h-8 w-8 p-0',
                                usr.remote_access_allowed && 'text-success',
                              )}
                              onClick={() => handleToggleRemoteAccess(usr)}
                              title={
                                usr.remote_access_allowed
                                  ? t('usersPage.remoteAccessOnTooltipShort')
                                  : t('usersPage.remoteAccessOffTooltipShort')
                              }
                            >
                              <Globe className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {usr.id !== user?.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn(
                                'h-8 w-8 p-0',
                                usr.status === 'active'
                                  ? 'text-muted-foreground hover:text-destructive'
                                  : 'text-success hover:text-success',
                              )}
                              onClick={() => handleToggleStatus(usr)}
                              title={usr.status === 'active' ? t('usersPage.deactivateAction') : t('usersPage.activate')}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="pgp" className="mt-4">
          <PgpAuthorsList />
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="assessments" className="mt-4">
          <AssessmentsAdminTab />
        </KeepAliveTabsPanel>
      </KeepAliveTabs>

      {/* Edit dialog — team / position / role */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => {
          if (!o) {
            setEditTarget(null);
            setEditForm(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t('usersPage.editUser')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{formatDisplayName(editTarget?.full_name)}</span>
              {editTarget?.employee_id && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {editTarget.employee_id}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>{t('usersPage.usernameLabel')}</Label>
                <Input
                  value={editForm.username}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      // Strip whitespace only — admins keep capitalisation.
                      username: e.target.value.replace(/\s/g, ''),
                    })
                  }
                  placeholder="username"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">{t('usersPage.usernameHint')}</p>
              </div>
              <div className="space-y-2">
                <Label>{t('usersPage.teamMultiLabel')}</Label>
                <div className="rounded-md border border-border/60 max-h-48 overflow-y-auto divide-y divide-border/60">
                  {teams.map((team) => {
                    const entry = editForm.team_ids.find((e) => e.team_id === team.id);
                    const checked = !!entry;
                    const isPrimary = entry?.is_primary === 1;
                    return (
                      <div
                        key={team.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40"
                      >
                        <Checkbox
                          className="shrink-0"
                          checked={checked}
                          onCheckedChange={(value) => {
                            setEditForm((prev) => {
                              if (!prev) return prev;
                              let next = [...prev.team_ids];
                              if (value === true) {
                                if (next.length >= 3) return prev;
                                const makePrimary = next.length === 0 ? 1 : 0;
                                next.push({ team_id: team.id, is_primary: makePrimary });
                              } else {
                                const wasPrimary =
                                  next.find((x) => x.team_id === team.id)?.is_primary === 1;
                                next = next.filter((x) => x.team_id !== team.id);
                                if (wasPrimary && next.length > 0) {
                                  next[0] = { ...next[0], is_primary: 1 };
                                }
                              }
                              return { ...prev, team_ids: next };
                            });
                          }}
                        />
                        <span className="text-sm flex-1 truncate">
                          <code className="font-mono text-micro mr-1 text-muted-foreground">
                            {team.code}
                          </code>
                          {team.name_mn}
                        </span>
                        {checked && (
                          <button
                            type="button"
                            className={cn(
                              'text-micro px-1.5 py-0.5 rounded border font-medium shrink-0 transition-colors',
                              isPrimary
                                ? 'bg-primary/15 text-primary border-primary/30'
                                : 'bg-muted text-muted-foreground border-border hover:bg-primary/10 hover:text-primary hover:border-primary/30',
                            )}
                            onClick={() => {
                              setEditForm((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  team_ids: prev.team_ids.map((x) => ({
                                    ...x,
                                    is_primary: x.team_id === team.id ? 1 : 0,
                                  })),
                                };
                              });
                            }}
                          >
                            {isPrimary ? t('usersPage.primary') : t('usersPage.makePrimary')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {editForm.team_ids.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('usersPage.noTeamSelected')}</p>
                )}
                {editForm.team_ids.length >= 3 && (
                  <p className="text-xs text-warning">
                    {t('usersPage.maxThreeTeams')}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('usersPage.position')}</Label>
                <Input
                  placeholder={t('usersPage.positionPlaceholder')}
                  value={editForm.position}
                  onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('usersPage.seniorityLabel')}</Label>
                <Select
                  value={editForm.seniority || 'none'}
                  onValueChange={(v) =>
                    setEditForm({
                      ...editForm,
                      seniority: v === 'none' ? '' : (v as Seniority),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('usersPage.seniorityNone')}</SelectItem>
                    {SENIORITY_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label_mn} <span className="text-muted-foreground">· {s.label_en}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editForm.seniority && (
                  <p className="text-micro text-muted-foreground">
                    {t('usersPage.track')}{' '}
                    <span className="font-medium text-foreground">
                      {seniorityFullLabel(
                        editForm.seniority as Seniority,
                        teams.find(
                          (t) => t.id === editForm.team_ids.find((e) => e.is_primary)?.team_id,
                        )?.code ?? null,
                      )}
                    </span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('attendanceShift.adminLabel')}</Label>
                {editTarget?.schedule_fixed ? (
                  <>
                    <p className="h-9 flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm tabular-nums">
                      {editTarget.schedule_label ?? '09:30–18:30'}{' '}
                      <span className="ml-1 text-muted-foreground">
                        ({t('attendanceShift.fixed')})
                      </span>
                    </p>
                    <p className="text-micro text-muted-foreground">
                      {t('attendanceShift.fixedHelp')}
                    </p>
                  </>
                ) : (
                  <>
                <Select
                  value={editForm.work_schedule}
                  onValueChange={(v) =>
                    setEditForm({ ...editForm, work_schedule: v as ScheduleKey })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {shiftOptions().map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        <span className="tabular-nums">{opt.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-micro text-muted-foreground">
                  {t('attendanceShift.adminHelp')}
                </p>
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('usersPage.roleLabel')}</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(val) => setEditForm({ ...editForm, role: val as UserRole })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {t(r.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('usersPage.roleHint')}
                </p>
              </div>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={editForm.is_support}
                  onCheckedChange={(c) => setEditForm({ ...editForm, is_support: c === true })}
                  className="mt-0.5"
                />
                <span className="text-sm text-muted-foreground">
                  {t('usersPage.supportStaffDesc')}
                </span>
              </label>
            </div>
          )}

          {editTarget && error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setEditTarget(null);
                setEditForm(null);
                setError('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog
        open={!!resetTarget}
        onOpenChange={(o) => {
          if (!o) {
            setResetTarget(null);
            setResetPwd('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('usersPage.resetPasswordTitle')}</DialogTitle>
            <DialogDescription>
              {t('usersPage.resetPasswordDesc', {
                name: formatDisplayName(resetTarget?.full_name),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Label>{t('usersPage.newPassword')}</Label>
            <Input
              type="password"
              placeholder={t('usersPage.passwordPlaceholder')}
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setResetTarget(null);
                setResetPwd('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleResetPassword} disabled={resetSaving || resetPwd.length < 6}>
              {resetSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('usersPage.resetAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset attendance device dialog */}
      <Dialog
        open={!!resetDeviceTarget}
        onOpenChange={(o) => {
          if (!o) setResetDeviceTarget(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t('usersPage.resetDeviceTitle')}</DialogTitle>
            <DialogDescription>
              {t('usersPage.resetDeviceDesc', {
                name: formatDisplayName(resetDeviceTarget?.full_name),
              })}
              {resetDeviceTarget?.attendance_device_bound_at && (
                <span className="mt-2 block text-xs text-muted-foreground">
                  {t('usersPage.currentBinding', {
                    date: formatDate(resetDeviceTarget.attendance_device_bound_at),
                  })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {/* Идэвхтэй браузерууд — hw_group ижил мөрүүд = нэг компьютер гэж таньсан. */}
          {(() => {
            const active = (devicesQuery.data?.devices ?? []).filter((d) => !d.revoked_at);
            if (active.length === 0) return null;
            return (
              <ul className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2 text-xs">
                {active.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <MonitorSmartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-foreground">{d.browser}</span>
                    <span className="text-muted-foreground">
                      {d.bound_via === 'hw_match'
                        ? t('usersPage.deviceViaHwMatch')
                        : d.bound_via === 'legacy'
                          ? t('usersPage.deviceViaLegacy')
                          : t('usersPage.deviceViaFirst')}
                      {' · '}
                      {formatDate(d.bound_at)}
                    </span>
                    {d.gpu && (
                      <span className="ml-auto truncate text-[11px] text-muted-foreground" title={`${d.gpu}${d.screen ? ` · ${d.screen}` : ''}`}>
                        {d.screen ?? ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
          {/* Revit add-in 1.9+ — лицензийн компьютерууд (зөвхөн admin; API нь admin-only). */}
          {user?.role === 'admin' && resetDeviceTarget && (
            <div className="border-t border-border/60 pt-3">
              <RevitLicenseDevices userId={resetDeviceTarget.id} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetDeviceTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleResetDevice} disabled={resetDeviceSaving}>
              {resetDeviceSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('usersPage.clearAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
