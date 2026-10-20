/**
 * `/app/documents/main/:id` (үндсэн төсөл) ба `/app/documents/project/:id`
 * (үндсэн төсөлгүй, өөрийн хавтастай ангиллын төсөл) — Google Drive хавтсыг
 * «Төслийн баримт бичиг» хуудаснаас бүтэн хуудсаар үзэх.
 *
 * Төслийн хуудасны «Баримт бичиг» табтай ЯГ ижил `DriveBrowser`; энд зөвхөн
 * толгой (нэр, буцах холбоос) нэмэгдэнэ.  Нэрийг хөнгөн `GET …/drive`-аас авна.
 */
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, HardHat } from 'lucide-react';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import DriveBrowser from './DriveBrowser';
import { describeDriveError } from './driveErrors';
import { DriveErrorState } from './DriveStates';
import type { DriveScope } from './types';
import { useDriveFolder, useDriveStatus } from './useDriveFolder';

export default function ProjectDriveDocumentsPage({ scope }: { scope: DriveScope }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const location = useLocation();
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  const isAdmin = user?.role === 'admin';
  const valid = Number.isInteger(id) && id > 0;

  const status = useDriveStatus(scope, id, valid);

  // Буцах сум = нэг шат дээд хавтас (03 → 00 → үндэс); үндсэн дээр л «Төслийн баримт бичиг».
  // `DriveBrowser`-тэй ИЖИЛ query key тул нэмэлт Drive дуудлага гарахгүй — `path` нь кэшээс.
  const [searchParams] = useSearchParams();
  const folderParam = searchParams.get('folder') || 'root';
  const inSubfolder = folderParam !== 'root';
  const folderView = useDriveFolder(scope, id, folderParam, valid && inSubfolder && status.data?.linked === true);
  const crumbs = folderView.first?.path ?? [];
  let backTo = '/app/documents';
  let backLabel = t('nav.projectDocuments');
  if (inSubfolder) {
    // path = [үндэс, …, одоогийн]; path ачаалагдаагүй байхад үндэс рүү (хамгийн аюулгүй).
    const parent = crumbs.length >= 3 ? crumbs[crumbs.length - 2] : undefined;
    backTo = parent ? `${location.pathname}?folder=${encodeURIComponent(parent.id)}` : location.pathname;
    backLabel = parent?.name ?? crumbs[0]?.name ?? status.data?.project_name ?? backLabel;
  }

  if (!valid) return <Navigate to="/app/documents" replace />;

  return (
    <PageContainer>
      <PageHeader
        title={status.data?.project_name ?? (status.isLoading ? '' : t('nav.projectDocuments'))}
        eyebrow={scope === 'main' ? t('mainProject.eyebrow') : t('nav.projectDocuments')}
        backTo={backTo}
        backLabel={backLabel}
        actions={
          scope === 'project' ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/app/projects/${id}`}>
                <ExternalLink className="h-4 w-4" />
                {t('documentsPage.openProject')}
              </Link>
            </Button>
          ) : user && (user.role === 'admin' || user.role === 'senior') ? (
            // Хуучин ЗХ тайлангууд яг энэ Drive хавтсанд байдаг тул нөхөж
            // бүртгэх урсгал эндээс эхэлнэ (`/app/asr/backfill?main=<id>`).
            // `state.from` — нөхөх хуудасны буцах сум яг энэ хавтас (`?folder=`) руу очно.
            <Button size="sm" variant="outline" asChild>
              <Link to={`/app/asr/backfill?main=${id}`} state={{ from: `${location.pathname}${location.search}` }}>
                <HardHat className="h-4 w-4" />
                {t('documentsPage.backfillAsr')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {status.isLoading ? (
        <Skeleton className="h-6 w-64" />
      ) : status.isError ? (
        <div className="rounded-xl border border-border bg-card">
          <DriveErrorState
            view={describeDriveError(status.error)}
            isAdmin={isAdmin}
            onRetry={() => void status.refetch()}
            retrying={status.isFetching}
          />
        </div>
      ) : (
        <DriveBrowser scope={scope} id={id} isAdmin={isAdmin} />
      )}
    </PageContainer>
  );
}
