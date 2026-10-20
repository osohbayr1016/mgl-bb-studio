import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, MousePointerClick, TrendingUp, X } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { teamChipClass, teamHex } from '@/shared/lib/team-colors';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { RepairTag, ValueBar } from './AllocationBits';
import { RosterList } from './RosterList';
import type {
  AllocActiveMember,
  AllocAxisEntry,
  AllocTeam,
  AllocationModel,
} from '../lib/allocation';
import { isRepairProject, projectHref, shortProjectLabel } from '../lib/allocation';
import { showPickNow } from '../lib/currentWork';
import { shortPersonName, teamRoster, type RosterContext } from '../lib/roster';

/**
 * Багийн БАРУУН талын самбар — Тоймын багийн донатын зүсэм (эсвэл домгийн
 * мөр) дээр дарахад бөглөгддөг (2026-09-16, эзний хүсэлт).  Эхлээд overlay
 * `Sheet` байсан; эзэн «Матриц табын баруун талын жижиг хэсэг шиг» гэсэн тул
 * одоо хуудсан дотор суурин `<aside>`, донат ба мэдээлэл зэрэг харагдана,
 * дарахад hover самбар алга болно (`DonutChart.activate`).  Юу ч сонгоогүй үед хоосон орхихгүй —
 * заавар + багуудын жагсаалт (дарж болно).
 *
 * Дотор нь: толгой (код · нэр · багийн хуудасны холбоос · хаах) → дөрвөн
 * жижиг тоо (хүн / төсөл / ажил / явц) → ажиллаж буй төслүүд (тууз, тухайн
 * хэмжүүрээр) → гишүүдийн ХАВТГАЙ нэрс (`teamRoster` — hover самбартай ЯГ
 * ижил жагсаалт, хүн бүр үндсэн төслөөрөө нэг удаа, төсөлгүй нь сүүлд бүдэг).
 * Бүх тоо `AllocationModel`-оос тул донат, hover, самбар гурав зөрөхгүй.
 *
 * 2026-09-17 (эзний хүсэлт: «ажлын тоо/явц биш — ирцээр ХЭН аль төслийг
 * сонгосныг, одоо аль дээр нь байгааг харуул»).  Ирцийн хэмжүүрт төсөл
 * бүрийн доор түүнийг өдрийн аль нэг шатанд (өглөө / үдээс хойш / гарахдаа)
 * сонгосон хүмүүсийн нэр гарна: ОДОО тэнд сууж буй нь ногоон цэгтэй, зөвхөн
 * өмнөх шатанд сонгосон нь бүдэг.  Нэг хүн өдөрт 2-3 төсөл солибол бүгд
 * дээр нь гарна — `cell.active_members`-ээс, тоо нь туузныхтай ижил.
 */
export function TeamPanel({
  row,
  teams,
  model,
  roster,
  onSelect,
}: {
  row: AllocAxisEntry<AllocTeam> | null;
  /** Заавар дахь жагсаалт — донатад орсон багууд (менежментгүй). */
  teams: AllocAxisEntry<AllocTeam>[];
  model: AllocationModel;
  roster: RosterContext;
  onSelect: (teamId: number | null) => void;
}) {
  const { t, lang } = useLanguage();

  const projects = useMemo(() => {
    if (!row) return [];
    return row.cells
      .map((cell) => {
        const project = model.byProject.find((p) => p.entity.id === cell.project_id)?.entity;
        const value = cell.active;
        return project ? { cell, project, value } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null && x.value > 0)
      .sort((a, b) => b.value - a.value || a.project.name.localeCompare(b.project.name));
  }, [row, model.byProject]);

  const groups = useMemo(() => (row ? teamRoster(roster, row) : []), [row, roster]);
  const nameOf = (id: number) => roster.people.get(id)?.full_name ?? `#${id}`;
  const stageLabel = (m: AllocActiveMember) =>
    m.stages.length === 0
      ? t('teams.stagePlanned')
      : m.stages.map((s) => t(`teams.stage_${s}`)).join(' → ');
  const names = groups.reduce((s, g) => s + g.people.length, 0);
  const max = Math.max(1, ...projects.map((p) => p.value));
  const maxMembers = Math.max(1, ...teams.map((x) => x.entity.member_count));

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('teams.panelTeam')}
        </span>
        {row && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('common.close')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!row ? (
          <div className="space-y-3">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {t('teams.teamPanelGuide')}
            </p>
            <div className="space-y-1.5">
              {teams.map((r) => (
                <Link
                  key={r.entity.id}
                  to={`/app/teams/${r.entity.id}`}
                  className="block w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/60"
                  title={t('teams.viewTeamPage')}
                >
                  <ValueBar
                    value={r.entity.member_count}
                    max={maxMembers}
                    color={teamHex(r.entity.code)}
                    label={`${r.entity.code} · ${pickLocalized(lang, r.entity.name_mn, r.entity.name_en)}`}
                    meta={t('teams.projectCount', { count: r.partners })}
                  />
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <header className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 shrink-0 rounded-[3px]"
                style={{ backgroundColor: teamHex(row.entity.code) }}
              />
              <Badge
                variant="outline"
                className={cn('px-1.5 py-0 font-mono text-[10px]', teamChipClass(row.entity.code))}
              >
                {row.entity.code}
              </Badge>
              {/* Багийн нэр дээр дарахад багийн профайл (2026-09-24, эзний хүсэлт). */}
              <Link
                to={`/app/teams/${row.entity.id}`}
                className="min-w-0 truncate text-sm font-semibold transition-colors hover:text-primary hover:underline"
                title={t('teams.viewTeamPage')}
              >
                {pickLocalized(lang, row.entity.name_mn, row.entity.name_en)}
              </Link>
              <Link
                to={`/app/teams/${row.entity.id}`}
                className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-primary"
                title={t('teams.viewTeamPage')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </header>
            <Link
              to={`/app/teams/${row.entity.id}`}
              className="flex items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              data-testid="team-panel-open-profile"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              {t('teamProductivity.openProfile')}
            </Link>
            <p className="-mt-1.5 text-[11px] text-muted-foreground">
              {t('teams.personCount', { count: row.entity.member_count })} ·{' '}
              {t('teams.projectCount', { count: row.partners })} ·{' '}
              {t('teams.metricActive')}
            </p>

            <div className="grid grid-cols-4 gap-1">
              {[
                {
                  label: t('teams.detailMembers'),
                  value: `${row.people}/${row.entity.member_count}`,
                },
                { label: t('teams.projectCountShort'), value: row.partners },
                { label: t('teams.detailTasks'), value: row.tasks },
                { label: t('teams.detailProgressShort'), value: `${row.avg_progress}%` },
              ].map((it) => (
                <div key={it.label} className="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                  <div className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                    {it.label}
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">{it.value}</div>
                </div>
              ))}
            </div>

            {/* «18 хүн байхад нүднүүдийн нийлбэр 32» — алдаа биш, зарим хүн
                хэд хэдэн төсөл дээр; тоог нуухгүй, ялгааг нь ил хэлнэ. */}
            {row.cellSum > row.people && (
              <p className="rounded-lg bg-muted/50 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                {t('teams.spreadNote', {
                  people: row.people,
                  sum: row.cellSum,
                  multi: row.multiProjectPeople,
                })}
              </p>
            )}

            {projects.length > 0 && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('teams.panelTeamProjects')} · {projects.length}
                </h4>
                <div className="mt-1.5 space-y-2">
                  {projects.map(({ cell, project, value }) => {
                    // Төслийн бус ажил одоо үргэлжилж байгаа хүн энд «одоо» биш
                    // (эзний шийдвэр, `lib/currentWork.ts`) — ногоон цэг, тоо, эрэмбэ гурвуулаа.
                    const pickNow = (m: AllocActiveMember) =>
                      showPickNow(m.now, model.dayWork.get(m.user_id));
                    const nowCount = cell.active_members.filter(pickNow).length;
                    // Мужаар: олон өдөр суусан нь эхэнд, «өмнө нь» гэсэн бүдгэрүүлэлт байхгүй.
                    const spanMode = model.range !== 'day';
                    const personDays = cell.active_members.reduce((s, m) => s + m.days, 0);
                    const picked = [...cell.active_members].sort(
                      (a, b) =>
                        Number(pickNow(b)) - Number(pickNow(a)) ||
                        (spanMode ? b.days - a.days : Number(b.latest) - Number(a.latest)) ||
                        nameOf(a.user_id).localeCompare(nameOf(b.user_id)),
                    );
                    const activeMeta = [
                      nowCount > 0 ? t('teams.panelNowCount', { count: nowCount }) : null,
                      spanMode ? t('teams.personDays', { count: personDays }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <div key={project.id}>
                        <ValueBar
                          value={value}
                          max={max}
                          color={teamHex(row.entity.code)}
                          label={shortProjectLabel(project.name)}
                          tag={isRepairProject(project) ? <RepairTag /> : undefined}
                          to={projectHref(project)}
                          meta={activeMeta || undefined}
                        />
                        {picked.length > 0 && (
                          <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-0.5 text-[11px] leading-snug">
                            {picked.map((m) => {
                              const name = nameOf(m.user_id);
                              const now = pickNow(m);
                              return (
                                <li
                                  key={m.user_id}
                                  className={cn(
                                    'inline-flex items-center gap-1',
                                    now
                                      ? 'font-medium text-foreground'
                                      : m.latest || spanMode
                                        ? 'text-muted-foreground'
                                        : 'text-muted-foreground/70 line-through decoration-muted-foreground/40',
                                  )}
                                  title={
                                    spanMode
                                      ? `${name} — ${t('teams.dayCount', { count: m.days })} · ${m.last_date}`
                                      : `${name} — ${stageLabel(m)}`
                                  }
                                >
                                  <span
                                    className={cn(
                                      'h-1.5 w-1.5 shrink-0 rounded-full',
                                      now ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                                    )}
                                  />
                                  <Link
                                    to={`/app/users/${m.user_id}`}
                                    className="hover:text-primary hover:underline"
                                  >
                                    {shortPersonName(name)}
                                  </Link>
                                  {spanMode && (
                                    <span className="tabular-nums text-muted-subtle">
                                      {t('teams.dayCount', { count: m.days })}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="border-t border-border/60 pt-2.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('teams.sheetMembers')} · {names}
              </h4>
              <RosterList groups={groups} className="mt-1.5" />
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
