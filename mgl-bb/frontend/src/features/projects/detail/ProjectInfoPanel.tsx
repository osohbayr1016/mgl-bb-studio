/** Мэдээлэл tab: the (currently hidden) description card, the passport /
 *  map editor and the admin-only MGL progress header. Extracted verbatim
 *  from `ProjectDetailPage.tsx` when that file was split into per-component
 *  modules — no behavioural change. */
import { FileText } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import type { ProjectDetailResponse } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { useLanguage } from '@/shared/i18n';
import ProjectMap from '@/features/projects/components/ProjectMap';
import { ProjectInfoTab } from '@/features/projects/components/ProjectInfoTab';
import { ProjectStatusReportSection } from '@/features/projects/components/ProjectStatusReportSection';

export function ProjectInfoPanel({
  id,
  project,
  isAdmin,
  canManageProjectWork,
  reload,
}: {
  id: string | undefined;
  project: ProjectDetailResponse['project'];
  isAdmin: boolean;
  /** Паспортыг (Word загварын 1.1/1.2/1.3) засах эрх — admin ЭСВЭЛ senior. */
  canManageProjectWork: boolean;
  reload: () => Promise<void>;
}) {
  const { t } = useLanguage();
  return (
    <>
      {/* Танилцуулга (project.description) — нуусан: гарчгийн доорх тайлбар
          харагдахгүй байх хүсэлтээр (display_title-ийн оронд). Кодыг үлдээв;
          `hidden` арилгахад дахин гарна. */}
      <Card className="hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" /> {t('projectDetailPage.introTitle')}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {t('projectDetailPage.introSubtitle')}
              </p>
            </div>
            {!isAdmin && (
              <Badge variant="outline" className="text-[11px] text-muted-foreground">
                {t('projectDetailPage.readOnly')}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            {project.description ? (
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {project.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t('projectDetailPage.noDescription')}
                {isAdmin && ` ${t('projectDetailPage.noDescriptionAdmin')}`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <ProjectInfoTab
        projectId={Number(id)}
        locationLabel={project.location}
        latitude={project.latitude}
        longitude={project.longitude}
        mapPreview={
          <ProjectMap
            name={project.name}
            latitude={project.latitude}
            longitude={project.longitude}
            locationLabel={project.location}
            editable={isAdmin}
            compact
            className="rounded-lg"
            onSave={async (lat, lng) => {
              await apiFetch(`/projects/${id}`, {
                method: 'PUT',
                data: { latitude: lat, longitude: lng },
              });
              await reload();
            }}
          />
        }
        /* ⚠️ `isAdmin` БИШ: `PUT /api/projects/:id/passport` нь 2026-09-02-нд
           `requireManager()` (admin + senior) болсон, учир нь «төслийг
           эхлүүлж буй багийн ахлах өөрөө бөглөнө».  `isAdmin` үлдээвэл
           senior-т маягт бүхэлдээ уншихад л зориулагдсан хэвээр үлдэж,
           backend-ийн өөрчлөлт хэрэглэгчид ХҮРЭХГҮЙ. */
        readOnly={!canManageProjectWork}
      />

      {/* Зөвхөн MGL ажлын явц картыг Мэдээлэл таб дээр харуулна.
       * Захиалагч / Бусад хэсэг нь Тайлан таб дээр л байна. */}
      {isAdmin && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-1 mb-2">
            <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('projectDetailPage.mglProgress')}
            </span>
          </div>
          <ProjectStatusReportSection projectId={Number(id)} category="mgl" headerOnly project={project} />
        </div>
      )}
    </>
  );
}

export default ProjectInfoPanel;
