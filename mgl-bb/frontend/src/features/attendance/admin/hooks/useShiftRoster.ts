import { useCallback, useMemo, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { AttendanceStatus, ScheduleKey, User, UserRole } from '@/shared/types';
import {
  SHIFT_KEYS,
  formatShiftDate,
  shiftOptions,
  type ShiftOption,
} from '@/features/attendance/shifts';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';
import type { AttendanceAdminTab, ShiftSort, ShiftSortKey } from '@/features/attendance/admin/constants';
import {
  buildTeamFacets,
  matchesTeams,
  pruneTeams,
  toggleTeam,
  type TeamFacet,
} from '@/features/attendance/admin/lib/teamFacets';
import { nameMatchesQuery } from '@/features/attendance/admin/utils/format';
import { SOURCE_RANK } from '@/features/attendance/admin/lib/shiftTone';
import { exportShiftRosterXlsx } from '@/features/attendance/admin/lib/exportShiftRosterXlsx';

/* =============================================================================
 *  «Ажлын цаг» таб — ХЭН ЯМАР ЭЭЛЖ СОНГОСОН БЭ.
 * -----------------------------------------------------------------------------
 *  2026-09-01-нээс ажилтан ээлжээ өөрөө сонгодог болсон (миграци 0199).  Тэр
 *  сонголт нь `user_work_schedules`-д огноотой мөр болж хадгалагддаг бөгөөд
 *  урьд нь ЗӨВХӨН тухайн хүн өөрөө (ирцийн хуудсан дээрх picker-ээс) эсвэл
 *  админ НЭГ ХҮНИЙГ засах диалогоос харж чаддаг байв.  Бүх ажилтныг нэг дор
 *  харах, ээлжээр нь эрэмбэлэх/шүүх гарц байгаагүй — энэ таб түүнийг нөхнө.
 *
 *  ЭХ СУРВАЛЖ: `GET /api/users` (requireManager).  Ирцийн админ хуудас
 *  админ-only тул эрх хүрнэ.  Тэр нь ээлжийн ГУРВАН талбар буцаана:
 *    · `work_schedule`          — ӨНӨӨДӨР бодитоор үйлчилж буй ээлж
 *                                 (6–8 сард зуны албадлага бүгдийг `early`
 *                                 болгодог тул сонголтоос ЗӨРНӨ);
 *    · `work_schedule_selected` — ажилтны СОНГОСОН ээлж;
 *    · `work_schedule_source`   — 'self' (ажилтан өөрөө сонгосон) /
 *                                 'admin' (админ тохируулсан) /
 *                                 'default' (хэзээ ч сонгогдоогүй).
 *
 *  ⚠️ Гурав дахийг нь БУУЛГАЖ БОЛОХГҮЙ: сонгоогүй хүний `selected` нь мөн
 *     'standard' гэж гардаг тул ээлжийн түлхүүр өөрөө «сонгосон уу?» гэдэгт
 *     хариулж чадахгүй.  Хуучин backend (талбаргүй) дээр `source` нь
 *     `undefined` ирэх тул «мэдэгдэхгүй» гэж үзэж, тоолуурт оруулахгүй.
 *
 *  ⚠️ Мөн «мөр байна» ≠ «өөрөө сонгосон»: админ хэрэглэгчийн засварын цонхоор
 *     ЯМАР Ч талбар засахад `work_schedule` давхар илгээгддэг тул зөвхөн
 *     албан тушаал засахад ч мөр үүснэ.  Тиймээс 'self' ба 'admin' хоёрыг
 *     ЯЛГАЖ харуулна — эс бөгөөс хүснэгт «сонгосон» гэж ХУДЛАА хэлнэ.
 * ===========================================================================*/

/** Хүснэгтийн нэг мөр — ажилтан бүрд нэг. */
export interface ShiftRosterRow {
  user_id: number;
  full_name: string;
  role: UserRole;
  position: string | null;
  profile_image: string | null;
  team_code: string | null;
  team_name: string | null;
  /** `buildTeamFacets`-ийн эрэмбэ — `/api/users`-ийн ӨӨРИЙНХ нь дараалал
   *  (`COALESCE(pt.sort_order, 999)`)-аас гаргасан индекс. */
  team_sort: number | null;
  /** Ажилтны СОНГОСОН ээлж (ирээдүйд хүчинтэй байж болно). */
  selected: ScheduleKey;
  /** ӨНӨӨДӨР бодитоор үйлчилж буй ээлж. */
  effective: ScheduleKey;
  /** Ээлж хаанаас гарсан бэ.  `undefined` = хуучин backend, мэдэгдэхгүй. */
  source: 'self' | 'admin' | 'default' | undefined;
  /** Сонголт хэзээнээс хүчинтэй (YYYY-MM-DD) — ирээдүйн огноо байж болно. */
  effective_from: string | null;
  /** Тогтмол ээлжтэй (user 69, `lib/specialShift.ts`) — picker-ээр
   *  солигдохгүй, `PUT /users/:id` ч 403 өгдөг тул харандаа гарахгүй. */
  fixed: boolean;
  /** Тогтмол ээлжийн шошго ('09:30–18:30') — зөвхөн `fixed` үед. */
  fixed_label: string | null;
}

/** Ээлжийн шүүлтийн нэг chip. */
export interface ShiftFacet {
  key: ScheduleKey;
  /** '08:00 – 17:00' — серверийн `schedule_options`-оос. */
  label: string;
  /** '8–17' — chip дээрх богино хэлбэр. */
  short: string;
  count: number;
}

export function useShiftRoster(tab: AttendanceAdminTab, feedback?: AdminFeedback) {
  const { t, lang } = useLanguage();

  const [shiftSort, setShiftSort] = useState<ShiftSort>({ key: 'shift', dir: 'asc' });
  const [shiftNameQuery, setShiftNameQuery] = useState('');
  /** Сонгосон ээлжүүд.  Хоосон = бүгд (`teamFacets`-ийн загвартай ижил). */
  const [shiftFilter, setShiftFilter] = useState<ScheduleKey[]>([]);
  const [shiftTeams, setShiftTeams] = useState<string[]>([]);

  // Таб нээгдэх хүртэл хүсэлт явуулахгүй.  Түлхүүр нь `useStaffOptions`-той
  // ЯГ ижил (['/users']) — хоёулаа нээгдсэн үед НЭГ хүсэлт хуваалцана.
  const usersQuery = useApiQuery<{ users: User[] }>(['/users'], '/users', {
    enabled: tab === 'shifts',
  });

  // Ээлжийн ШОШГЫГ сервер өгнө (`ORG_SHIFT_*` тохиргоог дагана).  Энэ бол
  // админы ӨӨРИЙНХ нь статус боловч `schedule_options` нь компанийн ерөнхий
  // тохиргоо тул бүх мөрд хүчинтэй.  Түлхүүр нь `AttendanceWidget`-тэй ижил
  // тул ихэвчлэн кэшнээс шууд ирнэ — нэмэлт хүсэлт үүсэхгүй.
  const statusQuery = useApiQuery<AttendanceStatus>('/attendance/my-status', {
    enabled: tab === 'shifts',
  });

  const options: ShiftOption[] = useMemo(
    () => shiftOptions(statusQuery.data?.schedule_options),
    [statusQuery.data?.schedule_options],
  );

  /** Ээлжийн эрэмбэ — цагаар (08:00 → 08:30 → 09:00).  `options` нь серверийн
   *  дарааллыг мөрддөг ба тэр нь `SCHEDULE_KEYS` (early, mid, standard). */
  const shiftRank = useMemo(() => {
    const rank = new Map<ScheduleKey, number>();
    options.forEach((o, i) => rank.set(o.key, i));
    // Серверийн жагсаалтад ороогүй түлхүүр (онолын) хамгийн ард.
    SHIFT_KEYS.forEach((k) => {
      if (!rank.has(k)) rank.set(k, rank.size);
    });
    return rank;
  }, [options]);

  const labelOf = useCallback(
    (key: ScheduleKey) => options.find((o) => o.key === key)?.label ?? key,
    [options],
  );

  // Бүх мөр — идэвхтэй, client БУС ажилтан.  `useStaffOptions`-ийн шүүлттэй
  // ЯГ ижил: ирцийн бүх roster (`role != 'client'`) ажилчин, дэмжих ажилтныг
  // ч агуулдаг — тэд ч ээлжтэй ажилладаг тул энд ч харагдана.
  const rows: ShiftRosterRow[] = useMemo(() => {
    const list = (usersQuery.data?.users ?? []).filter(
      (u) => u.status === 'active' && u.role !== 'client',
    );
    // `/api/users` нь аль хэдийн `COALESCE(pt.sort_order, 999)`-ээр эрэмбэлж
    // өгдөг тул багийн компанийн дарааллыг ЭХЛЭЭД ТААРСАН индексээр сэргээнэ
    // (`sort_order` баганыг өөрийг нь буцаадаггүй).
    const teamRank = new Map<string, number>();
    for (const u of list) {
      const code = u.team_code || '';
      if (!teamRank.has(code)) teamRank.set(code, teamRank.size);
    }
    return list.map((u) => ({
      user_id: u.id,
      full_name: u.full_name,
      role: u.role,
      position: u.position ?? null,
      profile_image: u.profile_image ?? null,
      team_code: u.team_code ?? null,
      team_name:
        (lang === 'en' ? (u.team_name_en ?? u.team_name_mn) : u.team_name_mn) ??
        u.team_code ??
        null,
      team_sort: teamRank.get(u.team_code || '') ?? null,
      selected: u.work_schedule_selected ?? u.work_schedule ?? 'standard',
      effective: u.work_schedule ?? u.work_schedule_selected ?? 'standard',
      source: u.work_schedule_source,
      effective_from: u.work_schedule_from ?? null,
      fixed: u.schedule_fixed === true,
      fixed_label: u.schedule_fixed ? (u.schedule_label ?? null) : null,
    }));
  }, [usersQuery.data, lang]);

  /* ---- Мөр дээрх ээлжийн засвар (харандаа) ----
   * Тайлангийн grid-ийн ирсэн цаг засах popover-той ИЖИЛ загвар
   * (`useDailyGridEditor`): нэг л мөрийн цонх нээгдэнэ (`editKey` = user_id).
   * Бичилт нь `PUT /users/:id` `{ work_schedule }` — «Хэрэглэгчид → засах»
   * цонхны ЯГ тэр зам: сервер `user_work_schedules`-д маргаашаас (зунаар
   * 9-р сарын 1-нээс) хүчинтэй мөр нэмж, `created_by` = админ тул мөр
   * «Админ тохируулсан» болж харагдана.  Хүчинтэй огноог сервер хариулна
   * (`schedule_effective_from`) — энд тооцохгүй. */
  const [editKey, setEditKey] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<ScheduleKey>('standard');
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const openEditor = useCallback((r: ShiftRosterRow) => {
    setEditKey(r.user_id);
    setEditValue(r.selected);
    setEditErr(null);
  }, []);

  const closeEditor = useCallback(() => setEditKey(null), []);

  const saveEdit = async (r: ShiftRosterRow) => {
    // Ижил ээлжийг дахин хадгалах нь утгагүй мөр үүсгэнэ (`created_by` админ
    // болж «өөрөө сонгосон» тэмдэг алдагдана) — зүгээр л хаана.
    if (editValue === r.selected) {
      setEditKey(null);
      return;
    }
    setEditSaving(true);
    setEditErr(null);
    try {
      const res = await apiFetch<{ schedule_effective_from?: string }>(`/users/${r.user_id}`, {
        method: 'PUT',
        data: { work_schedule: editValue },
      });
      setEditKey(null);
      await usersQuery.refetch();
      feedback?.setError(null);
      feedback?.setSuccess(
        t('attendanceAdminPage.shiftEditSaved', {
          name: formatDisplayName(r.full_name),
          label: labelOf(editValue),
          date: res.schedule_effective_from
            ? formatShiftDate(res.schedule_effective_from, lang)
            : '—',
        }),
      );
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setEditSaving(false);
    }
  };

  /** Ээлжийн chip-үүд — тоо нь ШҮҮЛТЭЭС ҮЛ ХАМААРАН бүх мөрөөс (`teamFacets`
   *  -ийн дүрэмтэй ижил: «нөгөөг дарвал хэд болох вэ» гэдгийг харуулна).
   *  Хүнгүй ээлж ч ГАРНА — «энэ ээлжийг хэн ч сонгоогүй» нь эзэнд хэрэгтэй
   *  мэдээлэл, chip алга болбол 0 гэдэг нь харагдахгүй. */
  const shiftFacets: ShiftFacet[] = useMemo(() => {
    const counts = new Map<ScheduleKey, number>();
    for (const r of rows) counts.set(r.selected, (counts.get(r.selected) ?? 0) + 1);
    return options.map((o) => ({
      key: o.key,
      label: o.label,
      short: o.short,
      count: counts.get(o.key) ?? 0,
    }));
  }, [rows, options]);

  const teamFacets: TeamFacet[] = useMemo(
    () => buildTeamFacets(rows, t, (r) => r.user_id),
    [rows, t],
  );

  /**
   * Ачаалсан өгөгдөлд байхгүй болсон багийн кодыг сонголтоос хасна.
   *
   * ⚠️ `useEffect` + `setShiftTeams` БИШ, RENDER дээр гаргаж авсан утга:
   *    эффект дотор setState дуудвал каскад render үүсгэдэг ба ESLint-ийн
   *    `react-hooks/set-state-in-effect` барина.  Түүхий сонголт нь
   *    `shiftTeams` төлөвт хэвээр үлдэж, зөвхөн ХЭРЭГЛЭХ үедээ шүүгддэг тул
   *    хэрэглэгч шүүлтээ буцааж сэргээхэд (жишээ нь өөр таб руу орж ирээд)
   *    сонголт нь алдагдахгүй.
   */
  const activeTeams = useMemo(
    () => pruneTeams(shiftTeams, teamFacets),
    [shiftTeams, teamFacets],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          nameMatchesQuery(r.full_name, shiftNameQuery) &&
          matchesTeams(r.team_code, activeTeams) &&
          (shiftFilter.length === 0 || shiftFilter.includes(r.selected)),
      ),
    [rows, shiftNameQuery, activeTeams, shiftFilter],
  );

  const sortedRows = useMemo(() => {
    const { key, dir } = shiftSort;
    const mul = dir === 'asc' ? 1 : -1;
    const nameOf = (r: ShiftRosterRow) => formatDisplayName(r.full_name).toLowerCase();
    return [...filteredRows].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'name':
          cmp = nameOf(a).localeCompare(nameOf(b));
          break;
        case 'team':
          cmp = (a.team_sort ?? Number.MAX_SAFE_INTEGER) - (b.team_sort ?? Number.MAX_SAFE_INTEGER);
          break;
        case 'shift':
          cmp = (shiftRank.get(a.selected) ?? 99) - (shiftRank.get(b.selected) ?? 99);
          break;
        case 'chosen':
          // Өсөхөөр: сонгоогүй → админ тохируулсан → өөрөө сонгосон.  Админы
          // асуулт нь ихэвчлэн «хэн сонголтоо хийгээгүй байна вэ» тул түүнийг
          // ЭХЭНД гаргана.  Мэдэгдэхгүй (хуучин backend) нь сонгоогүйтэй нэг зэрэг.
          cmp = SOURCE_RANK[a.source ?? 'default'] - SOURCE_RANK[b.source ?? 'default'];
          break;
      }
      // ⚠️ Чиглэлийг ЗӨВХӨН үндсэн харьцуулалтад үржүүлнэ.  Тэнцсэн үед нэрийн
      //    эрэмбэ нь ҮРГЭЛЖ А→Я — `(cmp || name) * mul` гэж бичвэл буурахаар
      //    эрэмбэлэхэд ижил ээлжтэй хүмүүсийн нэр ч урвуу болж, хэрэглэгч
      //    «яагаад Я-гаас эхлээд байна?» гэж эргэлздэг.  Мөн тогтвортой
      //    (stable) байх нь чухал: тэнцүү мөрүүд дахин ачаалах бүрд байраа
      //    сольж болохгүй.
      return cmp * mul || nameOf(a).localeCompare(nameOf(b));
    });
  }, [filteredRows, shiftSort, shiftRank]);

  const handleShiftSort = useCallback((key: ShiftSortKey) => {
    setShiftSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }, []);

  const toggleShift = useCallback((key: ScheduleKey) => {
    setShiftFilter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const toggleShiftTeam = useCallback((code: string) => {
    setShiftTeams((prev) => toggleTeam(prev, code));
  }, []);

  /** Сонголтоо ӨӨРӨӨ хийгээгүй хүмүүсийн тоо ('default' + 'admin').  Backend
   *  талбар байхгүй (хуучин worker) үед `undefined` — UI мөрийг нь огт
   *  харуулахгүй.
   *
   *  ⚠️ 'admin' нь энд ОРНО: админ тохируулсан ээлж бол ажилтны шийдвэр биш,
   *     тиймээс «хэнд сануулах вэ» гэсэн жагсаалтад хэвээр үлдэнэ. */
  const notChosenCount = useMemo(() => {
    if (rows.length === 0 || rows.every((r) => r.source === undefined)) return undefined;
    return rows.filter((r) => r.source === 'default' || r.source === 'admin').length;
  }, [rows]);

  /** Зуны албадлага зэргээс болж сонголт нь ӨНӨӨДӨР үйлчлэхгүй байгаа хүн
   *  байна уу — байвал хүснэгт «бодит» багана нэмж харуулна. */
  const hasEffectiveGap = useMemo(
    () => rows.some((r) => r.effective !== r.selected),
    [rows],
  );

  // `.catch` ЗААВАЛ: экспорт нь `onClick`-д шууд холбогдсон async функц тул
  // шидэлт нь unhandled rejection болж хэрэглэгчид ЮУ Ч харагдахгүй
  // (`useAttendanceSummary`-ийн ижил тайлбарыг үз).
  const exportXlsx = () => {
    exportShiftRosterXlsx(sortedRows, options, t).catch((err) => {
      console.error('[attendance] Ажлын цагийн XLSX экспорт амжилтгүй', err);
    });
  };

  return {
    isLoading: usersQuery.isLoading,
    isError: usersQuery.isError,
    rows,
    filteredRows,
    sortedRows,
    shiftFacets,
    teamFacets,
    shiftFilter,
    toggleShift,
    clearShiftFilter: () => setShiftFilter([]),
    shiftTeams: activeTeams,
    toggleShiftTeam,
    clearShiftTeams: () => setShiftTeams([]),
    shiftNameQuery,
    setShiftNameQuery,
    shiftSort,
    handleShiftSort,
    notChosenCount,
    hasEffectiveGap,
    labelOf,
    options,
    exportXlsx,
    refetch: usersQuery.refetch,
    editKey,
    editValue,
    setEditValue,
    editSaving,
    editErr,
    openEditor,
    closeEditor,
    saveEdit,
  };
}

export type ShiftRosterState = ReturnType<typeof useShiftRoster>;
