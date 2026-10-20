import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import type { AttendanceSession } from '@/shared/types';
import { OPEN_PAGE_SIZE } from '@/features/attendance/admin/constants';
import { TIME_RE } from '@/features/attendance/admin/utils/dates';
import { exportOpenSessionsXlsx } from '@/features/attendance/admin/lib/exportOpenSessionsXlsx';
import { printOpenSessions } from '@/features/attendance/admin/lib/printOpenSessions';
import {
  buildTeamFacets,
  openTeamLabel,
  sessionMatchesTeam,
} from '@/features/attendance/admin/lib/openSessionRows';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

/** Хаагдаагүй бүртгэлийн харагдац — карт жагсаалт эсвэл Excel-маягийн хүснэгт. */
export type OpenSessionsView = 'list' | 'table';

const OPEN_VIEW_KEY = 'attendance.openSessionsView';

/**
 * Өмнөх өдрүүдийн хаагдаагүй (гарах цаг бүртгээгүй) session-ууд —
 * "цаг нөхөх" жагсаалт.  Today tab дээр eager ачаална: тоо нь
 * анхааруулга-карт хэлбэрээр шууд харагдах учиртай.
 */
export function useOpenSessions(feedback: AdminFeedback, loadToday: () => void) {
  const { t } = useLanguage();
  const { setError, setSuccess } = feedback;

  const openSessionsQuery = useApiQuery<{
    sessions: AttendanceSession[];
    /** Хязгаараас ӨМНӨХ бодит тоо — таслагдсныг хэлэхэд. */
    total?: number;
    limit?: number;
  }>(['/attendance/open-sessions'], '/attendance/open-sessions');
  // `?? []` нь өгөгдөл ирээгүй үед РЕНДЕР БҮРТ шинэ массив үүсгэдэг тул
  // үүнээс хамаарах memo-ууд (facet, шүүлт) дэмий дахин тооцоологдоно.
  const openSessions = useMemo(
    () => openSessionsQuery.data?.sessions ?? [],
    [openSessionsQuery.data],
  );
  // Server тал `LIMIT`-тэй.  Хэрэв бодит тоо ачаалагдсанаас их бол
  // хэвлэсэн/татсан баримт БҮТЭН БИШ — үүнийг чимээгүй өнгөрөөж болохгүй,
  // учир нь энэ баримтыг сениорт «таны багийн бүх өр» гэж өгдөг.
  const openTotal = openSessionsQuery.data?.total ?? openSessions.length;
  const openTruncated = openTotal > openSessions.length;

  // Хаагаагүй бүртгэлийн checkbox сонголт → bulk delete.  Сонголтод үлдсэн
  // хуучирсан id-г server тал sessionDeletable шалгалтаараа алгасдаг тул
  // refetch-ийн дараа цэвэрлэхээс өөр хамгаалалт шаардлагагүй.
  const [selectedOpen, setSelectedOpen] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // "Хаагдаагүй" табын шүүлт (огнооны муж + нэр) ба bulk «хаах» dialog.
  const [openFrom, setOpenFrom] = useState('');
  const [openTo, setOpenTo] = useState('');
  const [openNameFilter, setOpenNameFilter] = useState('');
  // Багийн шүүлт — хоосон бол бүх баг.  Энэ табын гол зорилго нь тухайн
  // багийн сениорт өгөх баримт гаргах явдал болсон тул шүүлт нь хэвлэх ба
  // Excel хоёрт ЧУУЛГААР дамжина (`filteredOpenSessions` руу).
  const [openTeam, setOpenTeamState] = useState('');
  const [bulkCloseDialogOpen, setBulkCloseDialogOpen] = useState(false);
  const [bulkCloseTime, setBulkCloseTime] = useState('18:00');
  const [bulkCloseNextDay, setBulkCloseNextDay] = useState(false);
  const [bulkCloseNote, setBulkCloseNote] = useState('');
  const [bulkClosing, setBulkClosing] = useState(false);

  // Харагдацын сонголт — зөвхөн ДҮРСЛЭЛ (өгөгдөлд нөлөөгүй) тул серверт
  // хадгалах шаардлагагүй, гэхдээ нэг л удаа сонгоод мартмаар зүйл учир
  // `localStorage`-д үлдээнэ.  Өгөгдмөл нь Excel-маягийн хүснэгт: энэ таб
  // бол хэвлэх/экспортлох ажлын байр болохоос хүн харах хана биш.
  const [openView, setOpenViewState] = useState<OpenSessionsView>(() => {
    try {
      return localStorage.getItem(OPEN_VIEW_KEY) === 'list' ? 'list' : 'table';
    } catch {
      return 'table';
    }
  });
  const setOpenView = (v: OpenSessionsView) => {
    setOpenViewState(v);
    try {
      localStorage.setItem(OPEN_VIEW_KEY, v);
    } catch {
      /* нууц горим — сонголт нь энэ session-д л амьдарна */
    }
  };

  // Багийн сонголтууд.  Багийн ШҮҮЛТЭЭС үл хамааран бүх ачаалсан мөрөөс
  // тоологдоно — chip дээрх тоо нь «нөгөө багийг дарвал хэд болох вэ»
  // гэдгийг харуулах ёстой, тэгэхгүй бол сонгомогц бусад нь 0 болно.
  const openTeamFacets = useMemo(() => buildTeamFacets(openSessions, t), [openSessions, t]);

  // Сонгосон баг ачаалсан өгөгдөлд байхгүй болвол (жнь сүүлчийн мөр нь
  // хаагдсан) шүүлтийг өөрөө тайлна — үгүй бол хоосон дэлгэц дээр
  // «бүртгэл алга» гэж гарч, хэрэглэгч яагаад гэдгийг ойлгохгүй.
  useEffect(() => {
    if (openTeam && openTeamFacets.length > 0 && !openTeamFacets.some((f) => f.code === openTeam)) {
      setOpenTeamState('');
    }
  }, [openTeam, openTeamFacets]);

  // Баг солиход сонголт нь хуучин багийн мөрүүд дээр үлдэх нь аюултай:
  // «сонгосныг устгах» нь ХАРАГДАХГҮЙ мөрүүдийг устгана.
  const setOpenTeam = (code: string) => {
    setOpenTeamState(code);
    setSelectedOpen(new Set());
  };

  const filteredOpenSessions = useMemo(() => {
    const q = openNameFilter.trim().toLowerCase();
    // s.date нь ISO (YYYY-MM-DD) тул мөрийн харьцуулалт огнооны харьцуулалттай ижил.
    return openSessions.filter((s) => {
      if (openFrom && s.date < openFrom) return false;
      if (openTo && s.date > openTo) return false;
      if (!sessionMatchesTeam(s, openTeam)) return false;
      if (q && !(s.full_name ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [openSessions, openFrom, openTo, openTeam, openNameFilter]);

  // Хуудаслалт — бүх бүртгэлийг нэг дор биш, 20-оор хуваан харуулна.
  const [openPage, setOpenPage] = useState(0);
  const openPageCount = Math.max(1, Math.ceil(filteredOpenSessions.length / OPEN_PAGE_SIZE));
  const openPageSafe = Math.min(openPage, openPageCount - 1);
  const pagedOpenSessions = filteredOpenSessions.slice(
    openPageSafe * OPEN_PAGE_SIZE,
    openPageSafe * OPEN_PAGE_SIZE + OPEN_PAGE_SIZE,
  );
  // Шүүлт өөрчлөгдөхөд эхний хуудас руу буцаана.
  useEffect(() => {
    setOpenPage(0);
  }, [openFrom, openTo, openTeam, openNameFilter]);

  const toggleOpenSelected = (id: number) =>
    setSelectedOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Сонгосон хаагаагүй бүртгэлүүдийг зэрэг устгана.  Мөр бүрийн эрхийн
  // шалгалт server талд (sessionDeletable) — эрхгүй нь skipped-д тоологдоно.
  const bulkDeleteOpenSessions = async () => {
    const ids = [...selectedOpen];
    if (ids.length === 0) return;
    if (
      !(await confirmDialog({
        description: t('attendanceAdminPage.bulkDeleteConfirm', { count: ids.length }),
        variant: 'destructive',
      }))
    )
      return;
    setBulkDeleting(true);
    try {
      const res = await apiFetch<{ deleted: number; skipped: number }>(
        '/attendance/sessions/bulk-delete',
        { data: { ids } },
      );
      setSuccess(t('attendanceAdminPage.bulkDeleted', { count: res.deleted }));
      setSelectedOpen(new Set());
      openSessionsQuery.refetch();
      loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBulkDeleting(false);
    }
  };

  // Сонгосон хаагдаагүй бүртгэлүүдэд нэг гарах цаг бичиж зэрэг хаах.  Мөр бүрийн
  // эрх/хүчинтэйг server тал шалгаж, тохирохгүйг skipped-д тоолно.
  const openBulkCloseDialog = () => {
    setBulkCloseTime('18:00');
    setBulkCloseNextDay(false);
    setBulkCloseNote('');
    setBulkCloseDialogOpen(true);
  };

  const bulkCloseOpenSessions = async () => {
    const ids = [...selectedOpen];
    if (ids.length === 0) return;
    if (!TIME_RE.test(bulkCloseTime)) {
      setError(t('attendanceAdminPage.fixClockOutInvalidTime'));
      return;
    }
    setBulkClosing(true);
    try {
      const res = await apiFetch<{ closed: number; skipped: number }>(
        '/attendance/sessions/bulk-clock-out',
        {
          data: {
            ids,
            time: bulkCloseTime,
            next_day: bulkCloseNextDay,
            note: bulkCloseNote.trim() || null,
          },
        },
      );
      setSuccess(t('attendanceAdminPage.bulkClosed', { count: res.closed }));
      setSelectedOpen(new Set());
      setBulkCloseDialogOpen(false);
      openSessionsQuery.refetch();
      loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBulkClosing(false);
    }
  };

  // ---------------------------------------------------------------------
  // Excel татах / хэвлэх.
  //
  // ⚠️ ХОЁУЛАА `filteredOpenSessions`-ыг авна — дэлгэц дээр харагдаж буй 20
  // мөрийн ХУУДСЫГ БИШ.  «Хэвлэх» дарахад цаасан дээр 20 мөр гарч ирвэл
  // админ үлдсэнийг нь хэвлэсэн гэж бодох эрсдэлтэй.  Товчны шошгонд ч
  // мөрийн тоог зориуд бичсэн (`{count}`).
  // ---------------------------------------------------------------------
  const [exportingOpen, setExportingOpen] = useState(false);

  const exportOpenXlsx = async () => {
    if (filteredOpenSessions.length === 0) return;
    setExportingOpen(true);
    try {
      await exportOpenSessionsXlsx(
        filteredOpenSessions,
        {
          from: openFrom,
          to: openTo,
          teamCode: openTeam,
          teamLabel: openTeamLabel(openTeam, openTeamFacets),
        },
        t,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setExportingOpen(false);
    }
  };

  const printOpenList = () => {
    if (filteredOpenSessions.length === 0) return;
    const opened = printOpenSessions(
      filteredOpenSessions,
      {
        from: openFrom,
        to: openTo,
        nameFilter: openNameFilter,
        teamLabel: openTeamLabel(openTeam, openTeamFacets),
      },
      t,
    );
    if (!opened) setError(t('attendanceAdminPage.printPopupBlocked'));
  };

  return {
    openSessions,
    refetch: openSessionsQuery.refetch,
    filteredOpenSessions,
    pagedOpenSessions,
    openPageCount,
    openPageSafe,
    setOpenPage,
    selectedOpen,
    setSelectedOpen,
    toggleOpenSelected,
    openFrom,
    setOpenFrom,
    openTo,
    setOpenTo,
    openNameFilter,
    setOpenNameFilter,
    bulkDeleting,
    bulkDeleteOpenSessions,
    bulkClosing,
    bulkCloseDialogOpen,
    setBulkCloseDialogOpen,
    openBulkCloseDialog,
    bulkCloseOpenSessions,
    bulkCloseTime,
    setBulkCloseTime,
    bulkCloseNextDay,
    setBulkCloseNextDay,
    bulkCloseNote,
    setBulkCloseNote,
    openView,
    setOpenView,
    openTeam,
    setOpenTeam,
    openTeamFacets,
    openTotal,
    openTruncated,
    exportingOpen,
    exportOpenXlsx,
    printOpenList,
  };
}

export type OpenSessionsState = ReturnType<typeof useOpenSessions>;
