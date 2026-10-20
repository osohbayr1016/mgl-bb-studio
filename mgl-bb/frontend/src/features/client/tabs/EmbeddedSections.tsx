/**
 * Ажилтны талтай ХУВААЛЦСАН компонентуудыг (паспорт, захидлын бүртгэл, 3D
 * үзэгч) порталын хэсгийн хүрээнд байрлуулна.  Тэдгээрийн дотоод UI-г энд
 * ӨӨРЧЛӨХГҮЙ — ажилтны хуудсууд мөн хэрэглэдэг.  Эрхийг backend шийднэ
 * (захиалагчид паспорт зөвхөн уншигдана, гарын үсэг зөвхөн `pending` мөрөнд).
 */
import { lazy, Suspense } from 'react';

import { useLanguage } from '@/shared/i18n';

import { SectionHeader, SkeletonBar } from '../components/primitives';

// Хэсэг бүрийн хүнд компонент — тухайн хэсэг анх нээгдэх хүртэл chunk
// татагдахгүй (KeepAliveTabsPanel нь панелыг анх идэвхжихэд л mount хийнэ).
const ModelViewer = lazy(() => import('@/features/projects/components/ModelViewer'));
const CorrespondenceLogTab = lazy(() => import('@/features/projects/components/CorrespondenceLogTab'));
const ProjectInfoTab = lazy(() =>
  import('@/features/projects/components/ProjectInfoTab').then((m) => ({ default: m.ProjectInfoTab })),
);

const WRAP = 'flex flex-col gap-10 pt-10 md:gap-12 md:pt-14';

/**
 * Хуваалцсан компонентын `Card`-уудыг порталын хэв маягт (хурц өнцөг, сүүдэргүй,
 * 1px шугам) ЗӨВХӨН энэ хүрээн дотор нийцүүлнэ — `ui/card.tsx`-ийг хөндөхгүй,
 * ажилтны хуудсууд өөрчлөгдөхгүй.  `[data-slot=card]`-ийн өвөрмөц байдал
 * (класс + атрибут) нь Card-ийн `rounded-2xl shadow-apple`-ийг дарна.
 */
const EMBED =
  '[&_[data-slot=card]]:rounded-none [&_[data-slot=card]]:border [&_[data-slot=card]]:border-foreground/10 [&_[data-slot=card]]:shadow-none';

export function MailSection({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  return (
    <div className={WRAP}>
      <SectionHeader
        index="06"
        eyebrow={t('clientRoom.nav.mail')}
        title={t('clientRoom.mail.title')}
        description={t('clientRoom.mail.description')}
      />
      <div className={EMBED}>
        <Suspense fallback={<SkeletonBar className="h-72" />}>
          <CorrespondenceLogTab projectId={projectId} />
        </Suspense>
      </div>
    </div>
  );
}

export function InfoSection({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  return (
    <div className={WRAP}>
      <SectionHeader
        index="07"
        eyebrow={t('clientRoom.nav.info')}
        title={t('clientRoom.info.title')}
        description={t('clientRoom.info.description')}
      />
      <div className={EMBED}>
        <Suspense fallback={<SkeletonBar className="h-96" />}>
          <ProjectInfoTab projectId={projectId} readOnly />
        </Suspense>
      </div>
    </div>
  );
}

export function ModelSection({ projectId }: { projectId: number }) {
  const { t } = useLanguage();
  return (
    <div className={WRAP}>
      <SectionHeader
        index="08"
        eyebrow={t('clientRoom.nav.model')}
        title={t('clientRoom.model.title')}
        description={t('clientRoom.model.description')}
      />
      <div className="border border-foreground/10 bg-card p-2 md:p-4">
        <Suspense fallback={<SkeletonBar className="h-72" />}>
          <ModelViewer projectId={projectId} />
        </Suspense>
      </div>
    </div>
  );
}
