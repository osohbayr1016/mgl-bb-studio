/* =============================================================
 * «1.2 Scope of work / Хамрах хүрээ» хүснэгтийн засварлагч.
 * -------------------------------------------------------------
 * Жишиг Word баримтын багана бүр: № · Dic. (А/хэсэг) ·
 * Identification (Тодорхойлолт) · Team leader (Хариуцсан ахлах) ·
 * Хариуцсан мэргэжилтэн · File name (Файл хадгалах нэр).
 *
 * БҮХ нүд гараар засагдана — «бүгд customize хийх боломжтой»
 * гэсэн шаардлагын шууд хэрэгжилт.  «Багуудаас бөглөх» товч нь
 * зөвхөн ЭХЛЭЛИЙН утга тавина, дарсан үед л ажиллана.
 *
 * ⚠️ Энэ хүснэгт хадгалагдмагц гүйцэтгэлийн тайлангийн 1.2 нь
 * баг/багийн ахлахаас гаргаж авахаа болиод ЭНДЭЭС уншина
 * (`lib/introAuto.ts`).  Тайлангийн дотоод override нь дээр нь
 * давхарлагдсан хэвээр.
 * ============================================================= */

import { Layers, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ProjectScopeRow, ProjectTeamShare } from '@/shared/types';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  blankScopeRow,
  DISCIPLINE_LABEL_MN,
  seedScopeRows,
} from './passportSections';

export function ScopeRowsEditor({
  rows,
  onChange,
  readOnly = false,
  teamShares = [],
  disciplines = [],
  projectName = '',
  startDate = null,
}: {
  rows: ProjectScopeRow[];
  onChange: (next: ProjectScopeRow[]) => void;
  readOnly?: boolean;
  /** «Багуудаас бөглөх» товчны эх сурвалж. */
  teamShares?: ProjectTeamShare[];
  disciplines?: string[];
  projectName?: string;
  startDate?: string | null;
}) {
  const { t } = useLanguage();
  const patch = (id: string, key: keyof ProjectScopeRow, v: string) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, [key]: v } : r)));

  const canSeed = !readOnly && (disciplines.length > 0 || teamShares.length > 0);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
          <Layers className="w-3.5 h-3.5 text-primary" />
          {t('projectInfoTab.scopeRowsTitle')}
        </Label>
        {canSeed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-micro"
            onClick={() =>
              onChange(
                seedScopeRows({
                  existing: rows,
                  disciplines,
                  teamShares,
                  projectName,
                  startDate,
                }),
              )
            }
          >
            <Sparkles className="h-3 w-3 mr-1.5" />
            {t('projectInfoTab.scopeRowsSeed')}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-micro text-muted-foreground italic">
          {t('projectInfoTab.scopeRowsEmpty')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="text-micro text-muted-foreground">
                <th className="w-8 pb-1.5 text-left font-normal">№</th>
                <th className="w-20 pb-1.5 text-left font-normal">
                  {t('projectInfoTab.scopeColDic')}
                </th>
                <th className="pb-1.5 text-left font-normal">
                  {t('projectInfoTab.scopeColIdent')}
                </th>
                <th className="pb-1.5 text-left font-normal">
                  {t('projectInfoTab.scopeColLeader')}
                </th>
                <th className="pb-1.5 text-left font-normal">
                  {t('projectInfoTab.scopeColSpecialist')}
                </th>
                <th className="pb-1.5 text-left font-normal">
                  {t('projectInfoTab.scopeColFile')}
                </th>
                {!readOnly && <th className="w-8 pb-1.5" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="align-top">
                  <td className="py-1 pr-2 text-micro text-muted-foreground">{i + 1}</td>
                  <td className="py-1 pr-2">
                    {/* ⚠️ `value` нь ЗӨВХӨН `codeLabel` байх ЁСТОЙ.  Урьд нь
                        `codeLabel || DISCIPLINE_LABEL_MN[code] || code` байсан
                        тул нүдийг цэвэрлэхэд нөхөлт нь тэр дор нь буцаж
                        бичигдэж, нүд цэвэрлэгдэхгүй бөгөөд шинэ текст хуучин
                        дээр нь наалддаг байв.  Нөхөлтийг ачаалалтын үед
                        `fillScopeCodeLabels` хийнэ. */}
                    <Input
                      className="h-8 text-sm"
                      value={r.codeLabel}
                      readOnly={readOnly}
                      onChange={(e) => patch(r.id, 'codeLabel', e.target.value)}
                      placeholder={DISCIPLINE_LABEL_MN[r.code] || 'БА'}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 text-sm"
                      value={r.identification}
                      readOnly={readOnly}
                      onChange={(e) => patch(r.id, 'identification', e.target.value)}
                      placeholder={t('projectInfoTab.scopeColIdent')}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 text-sm"
                      value={r.leader}
                      readOnly={readOnly}
                      onChange={(e) => patch(r.id, 'leader', e.target.value)}
                      placeholder="Б.Билгүүн"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 text-sm"
                      value={r.specialist}
                      readOnly={readOnly}
                      onChange={(e) => patch(r.id, 'specialist', e.target.value)}
                      placeholder="Б.Уянга"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8 font-mono text-micro"
                      value={r.fileName}
                      readOnly={readOnly}
                      onChange={(e) => patch(r.id, 'fileName', e.target.value)}
                      placeholder="251218_PROJECT_BA_A"
                    />
                  </td>
                  {!readOnly && (
                    <td className="py-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 text-micro"
          onClick={() => onChange([...rows, blankScopeRow()])}
        >
          <Plus className="h-3 w-3 mr-1.5" />
          {t('projectInfoTab.addRow')}
        </Button>
      )}
    </div>
  );
}
