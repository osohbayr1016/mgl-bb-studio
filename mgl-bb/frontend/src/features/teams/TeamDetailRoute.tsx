import { Link, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import TeamDetailPage from './TeamDetailPage';
import { seesAllTeams, useOwnTeams } from './lib/teamAccess';

/**
 * `/app/teams/:id` — багийн дэлгэрэнгүй хуудасны ХААЛТ (2026-09-30).
 *
 * admin, senior бүх багийг харна (хуудас урьдын адил).  Бусад ажилтан зөвхөн
 * ӨӨРИЙН багийнхаа (`user_teams`) хуудсыг нээнэ; өөр багийн URL (гараар бичсэн,
 * хуучин холбоос) нь `/app/teams` руу буцаагдаж, тэндээс өөрийн багийн хуудас
 * руу орно (`MyTeamRedirect`).  Давталт үүсэхгүй: `/app/teams` нь
 * `/teams/mine`-аас (сервер хаалттай ижил эх сурвалж) өөрийн багийг л сонгоно.
 *
 * ЯАГААД `TeamDetailPage`-ийн ДОТОР БИШ ТУСДАА wrapper вэ: тэр файл идэвхтэй
 * дахин зохиогдож байдаг (2026-09-30-нд нэг өдөрт хоёр удаа бүтэн өөрчлөгдөж,
 * эхний хаалт арилсан).  Эрхийн шалгалт зохион байгуулалтаас хамаарахгүй байх ёстой.
 * Сервер тал ч `/api/teams/:id*` дээр өөр багт 403 өгдөг — энэ нь UX.
 */
export default function TeamDetailRoute() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const manager = seesAllTeams(user?.role);
  const own = useOwnTeams(!manager);

  if (manager) return <TeamDetailPage />;

  if (own.isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const teams = own.data?.teams ?? [];
  if (!teams.some((x) => String(x.id) === id)) return <Navigate to="/app/teams" replace />;

  // Хэд хэдэн багт харьяалагддаг ажилтан — бусад багийнхаа хуудас руу шилжих холбоос.
  const others = teams.filter((x) => String(x.id) !== id);

  return (
    <>
      {others.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-3 text-body text-muted-foreground lg:px-6">
          <span>{t('teamDetailPage.myOtherTeams')}:</span>
          {others.map((x) => (
            <Link
              key={x.id}
              to={`/app/teams/${x.id}`}
              title={x.name_mn}
              className="rounded-md border border-border/60 px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              {x.code}
            </Link>
          ))}
        </div>
      )}
      <TeamDetailPage />
    </>
  );
}
