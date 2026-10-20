import { CheckCircle2, Lock, MinusCircle, Pencil, UserCog } from 'lucide-react';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { formatShiftDate } from '@/features/attendance/shifts';
import { SHIFT_TONE } from '@/features/attendance/admin/lib/shiftTone';
import SortableTh from '@/features/attendance/admin/components/SortableTh';
import ShiftEditPopover from '@/features/attendance/admin/components/ShiftEditPopover';
import type { ShiftRosterState } from '@/features/attendance/admin/hooks/useShiftRoster';

/**
 * «Хэн ямар ажлын цаг сонгосон» хүснэгт.
 *
 * ⚠️ ХОЁР ээлж харуулна: `selected` (ажилтны сонголт) ба `effective` (өнөөдөр
 *    бодитоор үйлчилж байгаа).  6–8 сард зуны албадлага бүх хүнийг 08:00 болгодог
 *    тул тэр хоёр ЗӨРНӨ — «Өнөөдөр» багана зөвхөн зөрөх хүн байгаа үед
 *    (`hasEffectiveGap`) гарч ирнэ, эс бөгөөс ижилхэн хоёр багана зай эзэлнэ.
 */
export default function ShiftRosterTable({ state }: { state: ShiftRosterState }) {
  const { t, lang } = useLanguage();
  const {
    sortedRows,
    shiftSort,
    handleShiftSort,
    hasEffectiveGap,
    labelOf,
    editKey,
    openEditor,
    closeEditor,
  } = state;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead className="bg-muted/40">
          <tr className="text-xs">
            <th className="px-2 py-2 font-medium text-center border-b border-border w-10">
              {t('attendanceAdminPage.colNoShort')}
            </th>
            <SortableTh
              label={t('common.name')}
              sortKey="name"
              sort={shiftSort}
              onSort={handleShiftSort}
              align="left"
              className="px-3"
            />
            <SortableTh
              label={t('attendanceAdminPage.colTeam')}
              sortKey="team"
              sort={shiftSort}
              onSort={handleShiftSort}
              className="w-24"
            />
            <SortableTh
              label={t('attendanceAdminPage.colShiftSelected')}
              sortKey="shift"
              sort={shiftSort}
              onSort={handleShiftSort}
              className="w-44"
            />
            {hasEffectiveGap && (
              <th className="px-2 py-2 font-medium text-center border-b border-border w-40">
                {t('attendanceAdminPage.colShiftEffective')}
              </th>
            )}
            <SortableTh
              label={t('attendanceAdminPage.colShiftChosen')}
              sortKey="chosen"
              sort={shiftSort}
              onSort={handleShiftSort}
              className="w-32"
            />
            <th className="px-2 py-2 font-medium text-center border-b border-border w-32">
              {t('attendanceAdminPage.colShiftFrom')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r, idx) => {
            const tone = SHIFT_TONE[r.selected];
            return (
              <tr key={r.user_id} className="hover:bg-muted/30 transition-colors">
                <td className="px-2 py-1.5 text-center text-xs text-muted-foreground border-b border-border/40 tabular-nums">
                  {idx + 1}
                </td>
                <td className="px-3 py-1.5 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      {r.profile_image && (
                        <AvatarImage
                          src={`${MEDIA_BASE_URL}${r.profile_image}`}
                          alt={formatDisplayName(r.full_name)}
                        />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {formatDisplayName(r.full_name).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {formatDisplayName(r.full_name)}
                      </div>
                      {r.position && (
                        <span className="text-[10px] text-muted-foreground">{r.position}</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-center border-b border-border/40">
                  {r.team_code ? (
                    <span
                      title={r.team_name ?? r.team_code}
                      className={cn(
                        'font-mono text-[10px] px-1 rounded border',
                        teamChipClass(r.team_code),
                      )}
                    >
                      {r.team_code}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
                {/* Сонгосон ээлж — ЦАГААР бичигдэнэ ('08:30 – 17:30'), техник
                    нэрээр БИШ.  Шошго нь серверийн `schedule_options`-оос.
                    Chip дээр дарахад (харандаа) ээлжийг ЭНД засна — тайлангийн
                    grid-ийн ирсэн цаг засах popover-той ижил загвар.  Тогтмол
                    ээлжтэй хүнд (user 69) харандаа гарахгүй: сервер 403 өгнө. */}
                <td className="px-2 py-1.5 text-center border-b border-border/40">
                  {r.fixed ? (
                    <span
                      title={t('attendanceShift.fixedHelp')}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
                    >
                      <Lock className="h-3 w-3" />
                      {r.fixed_label ?? labelOf(r.selected)}
                    </span>
                  ) : (
                    <Popover
                      open={editKey === r.user_id}
                      onOpenChange={(o) => (o ? openEditor(r) : closeEditor())}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          title={t('attendanceAdminPage.editShiftTooltip')}
                          className={cn(
                            'group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors hover:brightness-95',
                            tone.chip,
                          )}
                        >
                          {labelOf(r.selected)}
                          <Pencil className="h-2.5 w-2.5 opacity-40 group-hover:opacity-100" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="center" className="w-64 space-y-2">
                        <ShiftEditPopover row={r} state={state} />
                      </PopoverContent>
                    </Popover>
                  )}
                </td>
                {hasEffectiveGap && (
                  <td
                    className={cn(
                      'px-2 py-1.5 text-center text-xs tabular-nums border-b border-border/40',
                      r.effective === r.selected
                        ? 'text-muted-foreground'
                        : cn('font-medium', SHIFT_TONE[r.effective].text),
                    )}
                    title={
                      r.effective === r.selected
                        ? undefined
                        : t('attendanceAdminPage.shiftEffectiveDiffHint')
                    }
                  >
                    {labelOf(r.effective)}
                  </td>
                )}
                {/* Ээлж хаанаас гарсан бэ.  ⚠️ «Мөр байна» гэдэг нь «ажилтан
                    өөрөө сонгосон» ГЭСЭН ҮГ БИШ: админ хэрэглэгчийн засварын
                    цонхоор ямар ч талбар засахад `work_schedule` давхар
                    илгээгддэг тул мөр үүснэ.  Тиймээс 'self' ба 'admin'
                    ЯЛГААТАЙ харагдана.  `undefined` = хуучин backend. */}
                <td className="px-2 py-1.5 text-center border-b border-border/40">
                  {r.source === undefined ? (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  ) : r.source === 'self' ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('attendanceAdminPage.shiftChosenYes')}
                    </span>
                  ) : r.source === 'admin' ? (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-300"
                      title={t('attendanceAdminPage.shiftChosenAdminHint')}
                    >
                      <UserCog className="h-3.5 w-3.5" />
                      {t('attendanceAdminPage.shiftChosenAdmin')}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                      title={t('attendanceAdminPage.shiftChosenNoHint')}
                    >
                      <MinusCircle className="h-3.5 w-3.5" />
                      {t('attendanceAdminPage.shiftChosenNo')}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center text-xs text-muted-foreground border-b border-border/40 tabular-nums">
                  {r.effective_from ? formatShiftDate(r.effective_from, lang) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
