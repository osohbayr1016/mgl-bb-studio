import { Clock, Download, RefreshCw, Search, Users } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import type { ShiftRosterState } from '@/features/attendance/admin/hooks/useShiftRoster';
import ShiftFilterChips from '@/features/attendance/admin/components/ShiftFilterChips';
import ShiftRosterTable from '@/features/attendance/admin/components/ShiftRosterTable';
import TeamFilterChips from '@/features/attendance/admin/components/TeamFilterChips';

/**
 * «Ажлын цаг» таб — хэн аль ээлжийг сонгосон бэ.
 *
 * 2026-09-01-нээс ажилтан ээлжээ өөрөө сонгодог болсон бөгөөд түүнийг нэг дор
 * харах газар байгаагүй: сонголт нь ажилтны өөрийнх нь ирцийн хуудсанд, эсвэл
 * админы «нэг хэрэглэгч засах» диалогт л харагддаг байв.  Энэ таб бүх ажилтныг
 * жагсааж, ЦАГААР нь (08:00–17:00 / 08:30–17:30 / 09:00–18:00) шүүх ба
 * эрэмбэлэх боломж өгнө.
 */
export default function ShiftsTab({ state }: { state: ShiftRosterState }) {
  const { t } = useLanguage();
  const {
    isLoading,
    isError,
    rows,
    sortedRows,
    shiftFacets,
    teamFacets,
    shiftFilter,
    toggleShift,
    clearShiftFilter,
    shiftTeams,
    toggleShiftTeam,
    clearShiftTeams,
    shiftNameQuery,
    setShiftNameQuery,
    notChosenCount,
    exportXlsx,
    refetch,
  } = state;

  return (
    <Card id="sec-att-admin-shifts" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" />
              {t('attendanceAdminPage.shiftRosterTitle')}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('attendanceAdminPage.shiftRosterHint')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('attendanceAdminPage.refresh')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={exportXlsx}
              disabled={sortedRows.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t('attendanceAdminPage.downloadXlsx')}
            </Button>
          </div>
        </div>

        {/* Сонголтоо хийгээгүй хүмүүсийн тоо — «хэнд сануулах вэ» гэдгийг
            хүснэгт уншихаас өмнө нэг харцаар хэлнэ.  Хуучин backend (талбар
            байхгүй) үед `undefined` тул мөр огт гарахгүй. */}
        {notChosenCount !== undefined && notChosenCount > 0 && (
          <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
            {t('attendanceAdminPage.shiftNotChosenNotice', { count: notChosenCount })}
          </p>
        )}

        {/* ⚠️ Мөр ачаалагдаагүй байхад chip-үүдийг ХАРУУЛАХГҮЙ: бүх тоолуур 0
            байх бөгөөд «энэ ээлжийг хэн ч сонгоогүй» гэсэн ХУДАЛ дүр зураг
            өгнө (0 тоо нь дараа нь чимээгүй солигдоно). */}
        {!isLoading && !isError && rows.length > 0 && (
          <>
            <ShiftFilterChips
              facets={shiftFacets}
              selected={shiftFilter}
              onToggle={toggleShift}
              onClear={clearShiftFilter}
              allCount={rows.length}
            />
            <TeamFilterChips
              facets={teamFacets}
              selected={shiftTeams}
              onToggle={toggleShiftTeam}
              onClear={clearShiftTeams}
              allCount={rows.length}
            />
          </>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={shiftNameQuery}
            onChange={(e) => setShiftNameQuery(e.target.value)}
            placeholder={t('attendanceAdminPage.searchByName')}
            className="h-9 pl-8"
          />
        </div>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('attendanceAdminPage.shiftRosterError')}
          </p>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Users className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">{t('attendanceAdminPage.shiftRosterEmpty')}</p>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Search className="mx-auto mb-2 h-8 w-8 opacity-30" />
            <p className="text-sm">{t('attendanceAdminPage.searchNoMatch')}</p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-[11px] italic text-muted-foreground md:hidden">
              {t('attendanceAdminPage.scrollTableHint')}
            </p>
            <ShiftRosterTable state={state} />
            <p className="text-xs text-muted-foreground">
              {t('attendanceAdminPage.employeeCount', { count: sortedRows.length })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
