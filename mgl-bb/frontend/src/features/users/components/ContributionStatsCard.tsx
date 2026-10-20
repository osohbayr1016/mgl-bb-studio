/**
 * «Миний хувь нэмэр» — ажилтны НАСАН ТУРШИЙН бодит хувь нэмрийн карт.
 *
 * Өмнө нь профайлын хажуу баганад сүүлийн 10 явцын бичлэгээс JS дээр бодсон
 * гурван тоо гардаг байсан — тэр нь ТӨӨРӨГДҮҮЛЭХ байсан: «дууссан» гэдэг нь
 * дууссан ДААЛГАВАР биш, 100% гэсэн явцын БИЧЛЭГ-ийг тоолдог байв.  Одоо
 * `GET /api/profiles/:id/stats` серверээс бүх түүхээр нь тоолж өгнө.
 *
 * Харуулах зүйлс (хэрэглэгчийн хүсэлт):
 *   · Хийсэн / нийт / хийгдэж буй даалгавар
 *   · Нийт оноо
 *   · Засварын ажлын хувь (`points.repair_ratio`) + цаг, бүртгэлийн тоо
 *   · Төслийн нөлөөлөл — төсөл тус бүрд оруулсан хувь ба тухайн төслийн НИЙТ
 *     хувь нэмрийн хэдийг эзэлж байгаа нь
 */
import type { LucideIcon } from 'lucide-react';
import { Activity, CheckCircle2, FolderKanban, ListChecks, Trophy, Wrench } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { isWorkerRole } from '@/shared/lib/roles';
import { cn } from '@/shared/lib/utils';
import { ErrorState } from '@/shared/components/ErrorState';
import { Card, CardContent } from '@/ui/card';
import { Progress } from '@/ui/progress';

/** `GET /api/profiles/:id/stats`-ийн хариу (backend/src/routes/profiles.ts). */
export interface ProfileStats {
  user_id: number;
  tasks: { total: number; completed: number; in_progress: number };
  /** `repair_ratio` нь 0..1 харьцаа (хувь БИШ) — 100-аар үржүүлж харуулна. */
  points: { total: number; progress: number; repair: number; repair_ratio: number };
  projects: {
    project_id: number | null;
    /** Засварын төсөл (`repair_projects`, 0194) — ЖИНХЭНЭ төсөл биш.
     *  `project_id`-тэй ЯГ НЭГ нь дүүрэн. */
    repair_project_id: number | null;
    is_repair_project: boolean;
    project_name: string | null;
    project_pct: number;
    project_total_pct: number;
    total_points: number;
    award_count: number;
  }[];
  repair: { entry_count: number; hours: number; computed_pct: number };
}

export interface ContributionStatsCardProps {
  /** Хэний статистик вэ — өгөөгүй бол нэвтэрсэн хэрэглэгчийнх. */
  userId?: number;
  className?: string;
}

/** Жижиг тоон нүд — хажуугийн 340px баганад 2 багана болж багтана. */
function Tile({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: string;
  bg: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md shrink-0', bg)}>
          <Icon className={cn('h-3.5 w-3.5', color)} />
        </span>
        <p className="min-w-0 truncate text-micro text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1 text-xl font-bold leading-tight tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function ContributionStatsCard({ userId, className }: ContributionStatsCardProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const targetId = userId ?? user?.id ?? 0;
  // Цэвэрлэгч (`worker`) даалгавар / оноо / төсөлтэй огт харьцдаггүй бөгөөд
  // сервер түүнд 403 өгнө — `/progress/my`-тэй ижил зарчмаар дуудахгүй.
  const enabled = !!targetId && !isWorkerRole(user?.role);

  const query = useApiQuery<ProfileStats>(
    ['/profiles/stats', targetId],
    `/profiles/${targetId}/stats`,
    { enabled, retry: false },
  );
  const stats = query.data ?? null;
  const loading = query.isLoading;

  if (!enabled) return null;

  const header = (
    <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
      <Activity className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold text-foreground">{t('profileStats.title')}</h3>
    </div>
  );

  // ⚠️ Хүсэлт БҮТЭЭГҮЙ үед 0 харуулж БОЛОХГҮЙ — `retry: false` тул нэг
  //    алдаа мөнхөрч, 40 даалгавар дуусгасан инженерт «хувь нэмэр алга»
  //    гэж итгэлтэйгээр худал хэлнэ.  Алдаа = ErrorState + дахин оролдох.
  if (query.isError) {
    return (
      <Card className={cn('border-border bg-card/60 backdrop-blur', className)}>
        {header}
        <CardContent className="p-0">
          <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
        </CardContent>
      </Card>
    );
  }

  // Ачаалж байхад '…', өгөгдөлгүй үед '—'.  ТООГ хэзээ ч зохиохгүй.
  const dash = loading ? '…' : '—';
  const repairPct = stats ? Math.round(stats.points.repair_ratio * 1000) / 10 : 0;
  const projects = stats?.projects ?? [];

  return (
    <Card className={cn('border-border bg-card/60 backdrop-blur', className)}>
      {header}

      <CardContent className="space-y-4 p-4">
        {/* ---- Даалгавар + оноо ---- */}
        <div className="grid grid-cols-2 gap-2">
          <Tile
            icon={CheckCircle2}
            color="text-success"
            bg="bg-success/10"
            label={t('profileStats.tasksCompleted')}
            value={stats?.tasks.completed ?? dash}
          />
          <Tile
            icon={ListChecks}
            color="text-warning"
            bg="bg-warning/10"
            label={t('profileStats.tasksInProgress')}
            value={stats?.tasks.in_progress ?? dash}
          />
          <Tile
            icon={FolderKanban}
            color="text-primary"
            bg="bg-primary/10"
            label={t('profileStats.tasksTotal')}
            value={stats?.tasks.total ?? dash}
          />
          <Tile
            icon={Trophy}
            color="text-info"
            bg="bg-info/10"
            label={t('profileStats.points')}
            value={stats ? stats.points.total.toFixed(1) : dash}
          />
        </div>

        {/* ---- Засварын ажлын хувь ---- */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Wrench className="h-3.5 w-3.5 text-warning" />
              {t('profileStats.repairShare')}
            </span>
            <span className="text-sm font-bold tabular-nums text-foreground">
              {stats ? `${repairPct.toFixed(1)}%` : dash}
            </span>
          </div>
          <Progress
            value={Math.min(100, Math.max(0, repairPct))}
            className="h-1.5 bg-muted"
            indicatorClassName="bg-warning"
          />
          <p className="text-micro text-muted-foreground">{t('profileStats.repairHint')}</p>
          <div className="flex items-center justify-between gap-2 text-micro text-muted-foreground">
            <span>
              {t('profileStats.repairHours')}:{' '}
              <b className="font-semibold tabular-nums text-foreground">
                {stats ? stats.repair.hours.toFixed(1) : dash}
              </b>
            </span>
            <span>
              {t('profileStats.repairEntries')}:{' '}
              <b className="font-semibold tabular-nums text-foreground">
                {stats ? stats.repair.entry_count : dash}
              </b>
            </span>
          </div>
        </div>

        {/* ---- Төслийн нөлөөлөл ---- */}
        <div className="space-y-2">
          <div>
            <h4 className="text-xs font-semibold text-foreground">
              {t('profileStats.projectImpact')}
            </h4>
            <p className="text-micro text-muted-foreground">
              {t('profileStats.projectImpactHint')}
            </p>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <p className="py-2 text-micro text-muted-foreground">{t('profileStats.noProjects')}</p>
          ) : (
            <ul className="space-y-2.5">
              {projects.map((p) => {
                // Тухайн төслийн НИЙТ хувь нэмэрт эзлэх хувь — 0-д хуваахаас
                // хамгаална (шинэ төсөлд нийт нь 0 байж болно).
                const share =
                  p.project_total_pct > 0
                    ? Math.min(100, (p.project_pct / p.project_total_pct) * 100)
                    : 0;
                return (
                  <li
                    // ⚠️ ХОСОЛСОН түлхүүр: `projects.id` ба `repair_projects.id`
                    //    нь тус тусдаа AUTOINCREMENT тул тоон id давхцаж болно.
                    key={p.is_repair_project ? `r:${p.repair_project_id}` : `p:${p.project_id}`}
                    className="space-y-1"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {p.project_name ?? '—'}
                        {p.is_repair_project && (
                          <span className="ml-1.5 text-micro font-normal text-muted-foreground">
                            {t('profileStats.internalWorkTag')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                        {p.project_pct.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={share} className="h-1.5 bg-muted" />
                    <p className="text-micro text-muted-foreground">
                      {t('profileStats.ofProject', { pct: share.toFixed(0) })}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ContributionStatsCard;
