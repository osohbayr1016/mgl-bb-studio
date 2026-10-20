import { useState } from 'react';
import { ArrowLeft, ArrowRight, HardHat, Loader2, Pencil, Plus } from 'lucide-react';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { useAsrList } from '@/features/projects/asr/api';
import type { AsrReport, AsrVisitPlan } from '@/features/projects/asr/types';
import { AsrPlansSection } from './AsrPlansSection';
import { AsrProjectNameDialog, type AsrProjectNameTarget } from './AsrProjectNameDialog';
import { AsrProjectBoard } from './board/AsrProjectBoard';

/**
 * Нэг төслийн ЗХ — толгой (нэр, «Шинэ тайлан»), ирэх хуваарь, дараа нь
 * хугацаагаар шүүгддэг самбар (`board/AsrProjectBoard.tsx`: хэдэн очилт,
 * хэн хэзээ явсан, багаар, тайлангууд).
 */
export function AsrProjectWorkspace({
  projectId,
  projectName,
  onBack,
  onOpenReport,
  onNewReport,
  onOpenPlan,
  onNewPlan,
  onOpenProject,
}: {
  projectId: number;
  projectName: string;
  onBack: () => void;
  onOpenReport: (row: AsrReport) => void;
  onNewReport: () => void;
  /** Хяналтын хуваарь (0331) — цонхыг `AsrPage` эзэмшдэг. */
  onOpenPlan: (plan: AsrVisitPlan) => void;
  onNewPlan: () => void;
  /** Нэгтгэгдсэн төслийн зорилт руу шилжих (миграц 0340). */
  onOpenProject: (projectId: number) => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [renaming, setRenaming] = useState<AsrProjectNameTarget | null>(null);
  const { data, isLoading, isError, error, refetch } = useAsrList(projectId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;

  /**
   * Төслийн ЗХ өөр төсөл рүү нэгтгэгдсэн (0340).  Самбараас арилсан
   * тул энд зөвхөн ХУУЧИН холбоос (мэдэгдэл, хадгалсан URL) ирнэ — хоосон
   * жагсаалт харуулах нь «тайлангууд алга болсон» гэж уншигдах тул хаашаа
   * шилжсэнийг ИЛ хэлнэ.
   */
  if (data?.merged_into) {
    const target = data.merged_into;
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t('asr.backToProjects')}
        </Button>
        <EmptyState
          icon={HardHat}
          title={t('asr.mergedTitle')}
          description={t('asr.mergedHint').replace('{name}', asrProjectName(target.name))}
          action={
            <Button type="button" size="sm" className="gap-2" onClick={() => onOpenProject(target.id)}>
              {t('asr.mergedOpen')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {t('asr.backToProjects')}
        </Button>
        {/* ЗХ-д харагдах нэр (0358) — серверийн хариунаас; ачаалагдаагүй бол дуудагчийнх.
            Утсанд нэр нь товчнуудын ДООР бүтэн мөрөөр (эс бөгөөс «M…» болж тасардаг). */}
        <div className="order-last flex min-w-0 basis-full items-center gap-1 sm:order-none sm:flex-1 sm:basis-auto">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold" data-testid="asr-project-title">
              {asrProjectName(data?.project?.name ?? projectName)}
            </h2>
            {data?.project?.asr_contract_no && (
              <p className="truncate text-xs text-muted-foreground">
                {t('asr.board.contractNo', { no: data.project.asr_contract_no })}
              </p>
            )}
          </div>
          {isAdmin && data?.project && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              title={t('asr.renameProject')}
              aria-label={t('asr.renameProject')}
              onClick={() =>
                setRenaming({
                  id: data.project!.id,
                  base_name: data.project!.base_name,
                  asr_name: data.project!.asr_name,
                  asr_contract_no: data.project!.asr_contract_no ?? null,
                })
              }
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {data?.can_write && (
          <Button type="button" size="sm" className="ml-auto gap-2 sm:ml-0" onClick={onNewReport}>
            <Plus className="h-4 w-4" />
            {t('asr.new')}
          </Button>
        )}
      </div>

      {/* Ирэх хуваарь — энэ төслийнх.  Хэн хэзээ явахыг тайлангаас ӨМНӨ харуулна. */}
      <AsrPlansSection projectId={projectId} onOpen={onOpenPlan} onNew={onNewPlan} />

      <AsrProjectBoard
        projectId={projectId}
        entries={data?.entries ?? []}
        teams={data?.teams ?? []}
        isAdmin={isAdmin}
        onOpen={onOpenReport}
        empty={<EmptyState icon={HardHat} title={t('asr.empty')} description={t('asr.emptyHint')} />}
      />

      <AsrProjectNameDialog target={renaming} onOpenChange={(v) => !v && setRenaming(null)} />
    </div>
  );
}
