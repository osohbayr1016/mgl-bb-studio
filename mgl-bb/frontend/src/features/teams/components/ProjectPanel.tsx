import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, MousePointerClick, X } from 'lucide-react';
import { teamHex } from '@/shared/lib/team-colors';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { RepairTag, ValueBar } from './AllocationBits';
import { DonutChart, type DonutSlice } from './DonutChart';
import { RosterList } from './RosterList';
import type { AllocAxisEntry, AllocProject, AllocationModel } from '../lib/allocation';
import { isRepairProject, isWorkforceTeam, projectHref, shortProjectLabel } from '../lib/allocation';
import { projectRoster, type RosterContext } from '../lib/roster';

/**
 * Төслийн БАРУУН талын самбар — Тоймын «Хүн хүч төслөөр» донатын зүсэм
 * (эсвэл домгийн мөр) дээр дарахад бөглөгддөг (2026-09-17, эзний хүсэлт:
 * «төслөөр нь хянах донат нэмээд, дотор нь ороход аль багийн хэдэн хүн
 * тухайн төсөл дээр байгааг харуулдаг байх»).  `TeamPanel`-тай ЯГ ижил
 * хэлбэр — хуудсан дотор суурин `<aside>`, overlay БИШ; хоёулаа нэг л
 * баруун талын нүдэнд ээлжлэн гарна.
 *
 * Дотор нь: толгой (төслийн нэр · төслийн хуудасны холбоос · хаах) →
 * хоёр тоо (хүн / баг) → БАГИЙН ДОНАТ (зүсэм = баг, багийн өнгөөр; тоо нь
 * тухайн хэмжүүрээр тэр төсөл дээр ажиллаж буй БҮХ хүн, үндсэн төсөл нь
 * өөр байсан ч) → баг бүрийн тууз → баг бүрийн доор гишүүдийн нэрс
 * (`projectRoster` — hover самбартай ЯГ ижил жагсаалт).  Менежментийн баг
 * энд ч ОРОХГҮЙ (эзний шийдвэр: «бүх донатаас хас»).
 *
 * ⚠️ Энд харагдах нийлбэр Тоймын зүсмийн тооноос (хүн бүр нэг л удаа,
 * үндсэн төслөөрөө) ИХ байж болно — алдаа биш, зарим хүн хэд хэдэн төсөл
 * дээр байна.  Юу ч сонгоогүй үед хоосон орхихгүй — заавар + хүнтэй
 * төслүүдийн жагсаалт (дарж болно).
 */
export function ProjectPanel({
  row,
  projects,
  model,
  roster,
  onSelect,
}: {
  row: AllocAxisEntry<AllocProject> | null;
  /** Заавар дахь жагсаалт — донатад орсон төслүүд (хүнтэй нь). */
  projects: Array<{ row: AllocAxisEntry<AllocProject>; value: number; color: string }>;
  model: AllocationModel;
  roster: RosterContext;
  onSelect: (projectId: number | null) => void;
}) {
  const { t, lang } = useLanguage();

  // Баг × энэ төсөл нүд бүр нэг зүсэм; менежментгүй, тоогоор буурах.
  const teams = useMemo(() => {
    if (!row) return [];
    return row.cells
      .map((cell) => {
        const team = model.byTeam.find((r) => r.entity.id === cell.team_id)?.entity;
        const code = team?.code ?? '?';
        return {
          code,
          teamId: cell.team_id,
          label: team ? pickLocalized(lang, team.name_mn, team.name_en) : code,
          value: cell.active,
        };
      })
      .filter((x) => x.value > 0 && isWorkforceTeam(x.code))
      .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));
  }, [row, model.byTeam, lang]);

  const slices: DonutSlice[] = useMemo(
    () =>
      teams.map((x) => ({
        key: x.teamId,
        code: x.code,
        label: x.label,
        value: x.value,
        color: teamHex(x.code),
      })),
    [teams],
  );

  const groups = useMemo(() => (row ? projectRoster(roster, row) : []), [row, roster]);
  const total = teams.reduce((s, x) => s + x.value, 0);
  const max = Math.max(1, ...teams.map((x) => x.value));
  const maxProject = Math.max(1, ...projects.map((p) => p.value));

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('teams.panelProject')}
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
              {t('teams.projectPanelGuide')}
            </p>
            <div className="space-y-1.5">
              {projects.map((p) => (
                <button
                  key={p.row.entity.id}
                  type="button"
                  onClick={() => onSelect(p.row.entity.id)}
                  className="w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/60"
                >
                  <ValueBar
                    value={p.value}
                    max={maxProject}
                    color={p.color}
                    label={shortProjectLabel(p.row.entity.name)}
                    meta={t('teams.teamCount', { count: p.row.partners })}
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <header className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-semibold" title={row.entity.name}>
                {shortProjectLabel(row.entity.name)}
              </span>
              {isRepairProject(row.entity) && <RepairTag />}
              {projectHref(row.entity) && (
                <Link
                  to={projectHref(row.entity) ?? ''}
                  className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-primary"
                  title={t('teams.rosterOpen')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </header>
            <p className="-mt-1.5 text-[11px] text-muted-foreground">
              {t('teams.personCount', { count: total })} ·{' '}
              {t('teams.teamCount', { count: teams.length })} ·{' '}
              {t('teams.metricActive')}
            </p>

            <div className="grid grid-cols-2 gap-1">
              {[
                { label: t('teams.detailMembers'), value: total },
                { label: t('teams.teamCountShort'), value: teams.length },
              ].map((it) => (
                <div key={it.label} className="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                  <div className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                    {it.label}
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">{it.value}</div>
                </div>
              ))}
            </div>

            {/* Аль багаас хэдэн хүн — донат, дараа нь тууз.  Домог нь
                доор нь тууз хэлбэрээр тул донатын өөрийн домог хэрэггүй. */}
            {slices.length > 0 && (
              <DonutChart
                slices={slices}
                size={150}
                legend="none"
                center={{ value: total, label: t('teams.detailMembers') }}
                emptyLabel={t('teams.emptyMatrix')}
                className="mx-auto"
              />
            )}

            {teams.length > 0 && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('teams.panelProjectTeams')} · {teams.length}
                </h4>
                <div className="mt-1.5 space-y-2">
                  {teams.map((x) => (
                    <ValueBar
                      key={x.teamId}
                      value={x.value}
                      max={max}
                      color={teamHex(x.code)}
                      label={`${x.code} · ${x.label}`}
                      to={`/app/teams/${x.teamId}`}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Баг бүрийн доор нэрс — hover самбартай ижил `projectRoster`. */}
            <section className="border-t border-border/60 pt-2.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('teams.sheetMembers')} · {groups.reduce((s, g) => s + g.people.length, 0)}
              </h4>
              <RosterList groups={groups} className="mt-1.5" />
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
