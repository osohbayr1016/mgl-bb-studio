/**
 * «ХЯНАХАД БЭЛЭН БАЙДАЛ» самбар — v2 §59 / §66 / §69 (`2-7`).
 *
 * ⚠️ ЭНЭ НЬ ХУУЛЬ ЗҮЙН ГЭРЧИЛГЭЭ БИШ (§69-R3).  `readiness.disclaimer` мөр
 *    нь картан дээр ҮРГЭЛЖ ХАРАГДАНА — tooltip дотор БИШ.  Кодод бичсэн
 *    дүрэм нь хангалтгүй: хэрэглэгч уншдаг газарт байх ёстой.
 *
 * ⚠️ ЭНЭ ДЭЛГЭЦЭД ХҮНИЙ НЭР, АВАТАР, «ХЭН» ГЭСЭН БАГАНА БАЙХГҮЙ.  Хувийн
 *    нууцын үл хөдлөх дүрэм (`0201:23-32`, `0203:25-31`, `0205:42-46`,
 *    `routes/learning.ts:67-71`) ба HR-ийн хил (`ChangeTracker.cs:90-100`,
 *    2026-08-26): «хэн хамгийн олон зөрчил гаргасан бэ» гэсэн харагдац нь
 *    ажилчдыг add-in-аас зайлуулна.  Сервер тэр талбаруудыг БУЦААХГҮЙ ба
 *    энэ файл тэднийг ХҮСЭХГҮЙ.
 *
 * ⚠️ ГУРВАН ТӨЛӨВ.  `UNKNOWN` («шалгалт бүрэн ажиллаагүй») нь `NOT_READY`
 *    -ЭЭС ӨӨР бөгөөд НОГООН БИШ.  `rules` хүснэгт ХООСОН нийлүүлэгдэнэ
 *    (эзний шийдвэр Ш4) тул эхний релизийн АНХДАГЧ хариулт нь `UNKNOWN`.
 *    Түүнийг ногооноор буюу «бэлэн» гэж харуулах нь энэ хөтөлбөрийн
 *    гаргаж болох ХАМГИЙН АЮУЛТАЙ гаралт.
 */
import { useMemo } from 'react';
import { AlertTriangle, HelpCircle, ShieldCheck } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';

/* ------------------------------------------------------------------ */
/*  Сервертэй гэрээ — `GET /api/compliance/projects/:id/readiness`      */
/* ------------------------------------------------------------------ */

type ReadinessStatus = 'READY' | 'NOT_READY' | 'UNKNOWN';

interface Blocker {
  key: string;
  count: number;
}

interface Gap {
  check: string;
  state: 'unknown' | 'asserted_absent' | 'asserted_present';
  source: 'manual' | 'detected' | 'derived' | 'unavailable';
  issue_class: string;
  severity: string;
  countable: boolean;
  label_mn: string;
  label_en: string;
  detail: Record<string, number | string | boolean | null>;
  blocked_reason: string | null;
}

interface ReadinessResponse {
  project_id: number;
  status: ReadinessStatus;
  blockers: Blocker[];
  /** ⚠️ НЭГТГЭСЭН тоолуур — `blockers[]`-оос сэргээхийг ОРОЛДОХГҮЙ. */
  open_by_severity: Record<string, number>;
  uncertain_open: number;
  completeness_pct: number;
  completeness_known: number;
  completeness_total: number;
  team_checks_done: number;
  team_checks_total: number;
  team_checks: Array<{ team_code: string; ran: boolean }>;
  evaluation_state: string;
  gaps: Gap[];
  checked_label: string;
  coverage_label: string;
  disclaimer_key: string;
  as_of: string;
}

interface QualityResponse {
  days: number;
  emitted: Record<string, number>;
  false_positive: Record<string, number>;
  fp_rate: Record<string, { value: number | null; measured: boolean }>;
  unnecessary_warnings: number;
  uncertain_rate: { value: number | null; measured: boolean };
  expected_violations: Record<string, number>;
  recall_authoritative: boolean;
  by_rule: Array<Record<string, unknown>>;
}

const SEVERITY_ROWS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

/**
 * ⚠️ НОГООН нь ЗӨВХӨН `READY`.  `UNKNOWN` нь ШАР — улаан ч, ногоон ч БИШ,
 *    учир нь тэр нь «муу» гэсэн үг биш, «МЭДЭХГҮЙ» гэсэн үг.  Хоёрыг нэг
 *    өнгөөр буудвал инженер «UNKNOWN = асуудалгүй» гэж сурна.
 */
const STATUS_STYLE: Record<ReadinessStatus, { box: string; Icon: typeof ShieldCheck }> = {
  READY: {
    box: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Icon: ShieldCheck,
  },
  NOT_READY: {
    box: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  UNKNOWN: {
    box: 'border-slate-500/50 bg-slate-500/10 text-slate-600 dark:text-slate-300',
    Icon: HelpCircle,
  },
};

const GAP_STATE_KEY: Record<Gap['state'], string> = {
  unknown: 'readiness.gaps.state.unknown',
  asserted_absent: 'readiness.gaps.state.absent',
  asserted_present: 'readiness.gaps.state.present',
};

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ReadinessPanel({ projectId, isManager }: { projectId: number; isManager: boolean }) {
  const { t, lang } = useLanguage();

  // ⚠️ `retry: false` — `2-2`/`2-3`/`2-5` нийлүүлэгдээгүй worker дээр 404 нь
  //    ТОГТМОЛ хариу; дахин оролдох нь зөвхөн саатал нэмнэ (`OverridesTab`-ын
  //    жишиг).
  const query = useApiQuery<ReadinessResponse>(
    ['/compliance/readiness', projectId],
    `/compliance/projects/${projectId}/readiness`,
    { retry: false },
  );

  const quality = useApiQuery<QualityResponse>(
    ['/compliance/quality', 30],
    '/compliance/quality?days=30',
    { retry: false, enabled: isManager },
  );

  const data = query.data;
  const gaps = useMemo(() => data?.gaps ?? [], [data]);

  const label = (g: Gap) => (lang === 'en' ? g.label_en : g.label_mn);

  return (
    <div className="space-y-4">
      {/* ───────────────── §69 — ХААЛГА ───────────────── */}
      <Card id="sec-project-readiness" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t('readiness.title')}</CardTitle>
          <CardDescription>{t('readiness.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading && <div className="h-24 animate-pulse rounded bg-muted/40" />}

          {/* ⚠️ АЛДАА ≠ «БЭЛЭН БИШ» ч, «БЭЛЭН» ч БИШ.  Хүсэлт унасныг
              төлөв мэт дүрслэх нь дахиад л худал мэдэгдэл болно. */}
          {query.isError && (
            <p className="text-sm text-muted-foreground">{t('readiness.unavailable')}</p>
          )}

          {data && (
            <>
              <div
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3 py-2.5',
                  STATUS_STYLE[data.status].box,
                )}
              >
                {(() => {
                  const Icon = STATUS_STYLE[data.status].Icon;
                  return <Icon className="mt-0.5 size-5 shrink-0" />;
                })()}
                <div className="min-w-0">
                  <div className="font-semibold">{t(`readiness.status.${data.status}`)}</div>
                  {data.blockers.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {data.blockers.map((b) => (
                        <li key={b.key}>· {t(b.key, { n: b.count })}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {SEVERITY_ROWS.slice(0, 3).map((sev) => (
                  <Counter
                    key={sev}
                    label={t(`readiness.sev.${sev}`)}
                    value={String(data.open_by_severity[sev] ?? 0)}
                  />
                ))}
                <Counter label={t('readiness.uncertain')} value={String(data.uncertain_open)} />
                <Counter
                  label={t('readiness.completeness')}
                  value={`${data.completeness_pct}%`}
                />
                <Counter
                  label={t('readiness.teamChecks')}
                  value={`${data.team_checks_done}/${data.team_checks_total}`}
                />
              </div>

              {/* ⚠️ Багийн КОД — хүний нэр БИШ.  §60-R3-аар «хариуцах» нь БАГ. */}
              {data.team_checks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.team_checks.map((tc) => (
                    <span
                      key={tc.team_code}
                      className={cn(
                        'rounded border px-2 py-0.5 text-xs',
                        tc.ran
                          ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                          : 'border-muted-foreground/30 text-muted-foreground',
                      )}
                    >
                      {tc.team_code}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                <div>
                  {data.checked_label} · {data.coverage_label}
                </div>
                {/* ⚠️ §69-R3 — ЭНЭ МӨР ҮРГЭЛЖ ХАРАГДАНА.  Хасах нь мэргэжлийн
                    хариуцлагын мэдэгдэл гаргах эрсдэл (§35–36). */}
                <div className="font-medium text-foreground/80">{t(data.disclaimer_key)}</div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ───────────────── §59 — ЦООРХОЙ ───────────────── */}
      <Card id="sec-project-gaps" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t('readiness.gaps.title')}</CardTitle>
          <CardDescription>{t('readiness.gaps.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {gaps.length === 0 && !query.isLoading && (
            <p className="text-sm text-muted-foreground">{t('readiness.unavailable')}</p>
          )}
          <ul className="space-y-2">
            {gaps.map((g) => (
              <li
                key={g.check}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm',
                  // ⚠️ Хэмжигдэхгүй шалгуур нь СААРАЛ ба ХАРАГДСАН хэвээр.
                  //    Хасвал «хэмжигдэхгүй» нь «асуудалгүй» болж уншигдана.
                  !g.countable && 'opacity-60',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{label(g)}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.countable
                      ? `${t(GAP_STATE_KEY[g.state])} · ${t(`readiness.source.${g.source}`)}`
                      : t('readiness.gaps.unavailable')}
                  </span>
                </div>
                {g.blocked_reason && (
                  <p className="mt-1 text-xs text-muted-foreground">{g.blocked_reason}</p>
                )}
                {g.countable && Object.keys(g.detail).length > 0 && (
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {Object.entries(g.detail)
                      .map(([k, v]) => `${k}: ${v === null ? '—' : String(v)}`)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ───────────── §66 — ДҮРМИЙН ЧАНАР (зөвхөн ахлагч) ───────────── */}
      {isManager && (
        <Card id="sec-project-quality" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>{t('readiness.quality.title')}</CardTitle>
            {/* ⚠️ ДҮРМИЙН чанар — ХҮНИЙ гүйцэтгэл БИШ.  Гарчиг нь тэр ялгааг
                ил хэлнэ, эс бөгөөс самбар нь ажилтны үнэлгээ мэт уншигдана. */}
            <CardDescription>{t('readiness.quality.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quality.isError && (
              <p className="text-sm text-muted-foreground">{t('readiness.unavailable')}</p>
            )}
            {quality.data && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Counter
                    label={t('readiness.quality.emitted')}
                    value={String(sumCounts(quality.data.emitted))}
                  />
                  <Counter
                    label={t('readiness.quality.falsePositive')}
                    value={String(sumCounts(quality.data.false_positive))}
                  />
                  <Counter
                    label={t('readiness.quality.unnecessary')}
                    value={String(quality.data.unnecessary_warnings)}
                  />
                  <Counter
                    label={t('readiness.quality.uncertainRate')}
                    value={pct(quality.data.uncertain_rate)}
                  />
                </div>
                {/* ⚠️ Мөр бүр нь ДҮРЭМ (`rule_uid`) — хэрэглэгч БИШ. */}
                {quality.data.by_rule.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1 pr-3">{t('readiness.quality.rule')}</th>
                          <th className="py-1 pr-3 text-right">
                            {t('readiness.quality.falseSignals')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {quality.data.by_rule.slice(0, 20).map((r, i) => (
                          <tr key={String(r['rule_uid'] ?? i)} className="border-t">
                            <td className="py-1 pr-3 font-mono text-xs">
                              {String(r['rule_uid'] ?? '—')}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {Number(r['false_positive'] ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* ⚠️ FN-ийг хэмжих ЭРХ МЭДЭЛТЭЙ газар нь D1 БИШ — `run_golden.py`.
                    Тиймээс энэ хэсэг «ойролцоо» гэж ИЛ шошголно. */}
                {!quality.data.recall_authoritative && (
                  <p className="text-xs text-muted-foreground">{t('readiness.quality.proxy')}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function sumCounts(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** ⚠️ ХЭМЖИГДЭЭГҮЙ нь «0%» БИШ — тэр нь төгс гүйцэтгэл мэт уншигдана. */
function pct(rate: { value: number | null; measured: boolean }): string {
  if (!rate.measured || rate.value === null) return '—';
  return `${Math.round(rate.value * 100)}%`;
}

export default ReadinessPanel;
