import {
  FileSpreadsheet,
  List,
  Printer,
  RefreshCw,
  Search,
  Table2,
  Timer,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Checkbox } from '@/ui/checkbox';
import type { OpenSessionsState } from '@/features/attendance/admin/hooks/useOpenSessions';
import OpenTeamFilter from '@/features/attendance/admin/components/OpenTeamFilter';

/** «Хаагдаагүй» табын шүүлт (огнооны муж + нэр), гаралт (хэвлэх / Excel) ба
 *  bulk үйлдлийн мөр. */
export default function OpenSessionsFilters({ open }: { open: OpenSessionsState }) {
  const { t } = useLanguage();
  const {
    openFrom,
    setOpenFrom,
    openTo,
    setOpenTo,
    openNameFilter,
    setOpenNameFilter,
    filteredOpenSessions,
    selectedOpen,
    setSelectedOpen,
    bulkClosing,
    bulkDeleting,
    openBulkCloseDialog,
    bulkDeleteOpenSessions,
    openView,
    setOpenView,
    exportingOpen,
    exportOpenXlsx,
    printOpenList,
  } = open;

  const count = filteredOpenSessions.length;
  const noRows = count === 0;

  return (
    <>
      {/* Шүүлт: огнооны муж + нэр */}
      <div className="flex flex-wrap items-end gap-2 pt-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            {t('attendanceAdminPage.startDate')}
          </Label>
          <Input
            type="date"
            value={openFrom}
            max={openTo || undefined}
            onChange={(e) => setOpenFrom(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            {t('attendanceAdminPage.endDate')}
          </Label>
          <Input
            type="date"
            value={openTo}
            min={openFrom || undefined}
            onChange={(e) => setOpenTo(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        {(openFrom || openTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setOpenFrom('');
              setOpenTo('');
            }}
          >
            {t('attendanceAdminPage.openFilterAllDates')}
          </Button>
        )}
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={openNameFilter}
            onChange={(e) => setOpenNameFilter(e.target.value)}
            placeholder={t('attendanceAdminPage.openSearchName')}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Багийн шүүлт — хэвлэх/Excel хоёрт нь ижилхэн нөлөөлнө. */}
      <OpenTeamFilter open={open} />

      {/* Харагдац + гаралт.  Хэвлэх/Excel хоёр нь СОНГОЛТООС ХАМААРАХГҮЙ —
          шүүлтэд тохирсон БҮХ мөрийг (хуудаслалтыг үл харгалзан) авна. */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <div className="inline-flex rounded-md border border-border p-0.5">
          <Button
            size="sm"
            variant={openView === 'table' ? 'secondary' : 'ghost'}
            className="h-7 gap-1.5 px-2 text-xs"
            aria-pressed={openView === 'table'}
            onClick={() => setOpenView('table')}
          >
            <Table2 className="h-3.5 w-3.5" />
            {t('attendanceAdminPage.openViewTable')}
          </Button>
          <Button
            size="sm"
            variant={openView === 'list' ? 'secondary' : 'ghost'}
            className="h-7 gap-1.5 px-2 text-xs"
            aria-pressed={openView === 'list'}
            onClick={() => setOpenView('list')}
          >
            <List className="h-3.5 w-3.5" />
            {t('attendanceAdminPage.openViewList')}
          </Button>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={noRows}
          onClick={printOpenList}
        >
          <Printer className="h-3.5 w-3.5" />
          {t('attendanceAdminPage.openPrint', { count })}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={noRows || exportingOpen}
          onClick={() => void exportOpenXlsx()}
        >
          {exportingOpen ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5" />
          )}
          {t('attendanceAdminPage.openExportXlsx', { count })}
        </Button>
      </div>

      {/* Бүгдийг сонгох + bulk хаах/устгах */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="open-select-all"
            checked={
              filteredOpenSessions.length > 0 &&
              filteredOpenSessions.every((s) => selectedOpen.has(s.id))
                ? true
                : filteredOpenSessions.some((s) => selectedOpen.has(s.id))
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(v) =>
              setSelectedOpen(
                v === true ? new Set(filteredOpenSessions.map((s) => s.id)) : new Set(),
              )
            }
          />
          <label
            htmlFor="open-select-all"
            className="cursor-pointer select-none text-xs text-muted-foreground"
          >
            {t('attendanceAdminPage.selectAll')}
          </label>
        </div>
        {selectedOpen.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 gap-1.5"
              disabled={bulkClosing || bulkDeleting}
              onClick={openBulkCloseDialog}
            >
              <Timer className="h-3.5 w-3.5" />
              {t('attendanceAdminPage.closeSelected', { count: selectedOpen.size })}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 gap-1.5"
              disabled={bulkDeleting || bulkClosing}
              onClick={() => void bulkDeleteOpenSessions()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('attendanceAdminPage.deleteSelected', { count: selectedOpen.size })}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
