import { Link, Navigate } from 'react-router-dom';
import { Building2, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { PageContainer } from '@/shared/components/PageContainer';
import { useOwnTeams } from './lib/teamAccess';

/**
 * `/app/teams` — admin/senior БУС хэрэглэгчийн Багууд хэсэг (2026-09-30).
 *
 * Эзний хүсэлт: «энгийн ажилтан Багууд хэсгээс зөвхөн өөрийн багийн мэдээллийг
 * авдаг байг».  Бүх багийн хуваарилалтын самбар тэдэнд харагдахгүй (сервер ч
 * 403) — оронд нь өөрийн (үндсэн) багийн дэлгэрэнгүй хуудас руу шууд орно.
 * Хэд хэдэн багт харьяалагддаг бол үндсэн нь нээгдэж, бусад багийн холбоос
 * дэлгэрэнгүй хуудасны дээд талд байна (`TeamDetailPage`).
 */
export function MyTeamRedirect() {
  const { t } = useLanguage();
  const own = useOwnTeams(true);

  if (own.isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const first = own.data?.teams[0];
  if (first) return <Navigate to={`/app/teams/${first.id}`} replace />;

  return (
    <PageContainer className="mx-auto max-w-md py-16 text-center">
      <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">
        {own.isError ? t('teams.ownTeamLoadFailed') : t('teams.noOwnTeam')}
      </p>
      <Link to="/app" className="mt-4 inline-block text-sm text-primary hover:underline">
        ← {t('common.back')}
      </Link>
    </PageContainer>
  );
}
