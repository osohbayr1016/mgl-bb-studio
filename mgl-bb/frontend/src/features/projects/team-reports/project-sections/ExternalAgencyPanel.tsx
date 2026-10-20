import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Save, Loader2, CheckCircle2, CircleDashed, Check } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Textarea } from '@/ui/textarea';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import type { ProjectStatusReport } from '@/shared/types';

/* =============================================================
 * ExternalAgencyPanel — "Гадны байгууллагууд" төслийн нэгдсэн таб.
 * -------------------------------------------------------------
 * Гадны 4 байгууллагатай харилцсан тэмдэглэл + "Хийгдсэн" төлөв.
 * Эдгээр нь ДАРААЛЛААР явагддаг (бүгд зэрэг биш) тул дэс дараат
 * шат (stepper) + явцаар харуулна.
 *
 * Өгөгдөл нь өмнөх ProjectStatusReportSection-тэй ИЖИЛ
 * project_status_reports мөрөнд (status-report endpoint) хадгалагдана.
 * Тийм учраас:
 *   - ProjectStatusReportSection-тэй ижил query key ашиглаж кэш
 *     хуваалцана;
 *   - PUT нь бүх талбарыг солидог тул БҮТЭН report-ыг буцааж
 *     илгээнэ (гэрээ/санхүүжилт/холбоо барих мэдээллийг хадгалахын тулд).
 * ============================================================= */

interface AgencyDef {
  noteKey: 'nema_note' | 'health_note' | 'bdc_experts_note' | 'bdc_review_note';
  doneKey: 'nema_done' | 'health_done' | 'bdc_experts_done' | 'bdc_review_done';
  title: string;
  hint: string;
}

const AGENCIES: AgencyDef[] = [
  {
    noteKey: 'nema_note',
    doneKey: 'nema_done',
    title: 'Онцгой байдалын ерөнхий газар',
    hint: 'Хүсэлт өгсөн / шийдвэрлэгдсэн / тайлбар',
  },
  {
    noteKey: 'health_note',
    doneKey: 'health_done',
    title: 'Эрүүл мэндийн хяналтын газар',
    hint: 'Гүйцэтгэлийн төлөв',
  },
  {
    noteKey: 'bdc_experts_note',
    doneKey: 'bdc_experts_done',
    title: 'Барилгын хөгжлийн төв — экспертүүдийн томилгоо',
    hint: 'Эксперт нэр / огноо / хариу',
  },
  {
    noteKey: 'bdc_review_note',
    doneKey: 'bdc_review_done',
    title: 'Барилгын хөгжлийн төв — Магадлалын дүгнэлтийн нэгтгэл',
    hint: 'Дугаар / огноо / тайлбар',
  },
];

const EMPTY_REPORT: ProjectStatusReport = {
  project_id: 0,
  contact_name: null,
  contact_phone: null,
  contact_email: null,
  contract_start: null,
  contract_end: null,
  funding_milestones: [],
  nema_note: null,
  health_note: null,
  bdc_experts_note: null,
  bdc_review_note: null,
  nema_done: false,
  health_done: false,
  bdc_experts_done: false,
  bdc_review_done: false,
  notes: null,
  updated_at: '',
  updated_by_id: null,
};

interface StatusReportResponse {
  report: ProjectStatusReport | null;
  notes: unknown[];
}

export function ExternalAgencyPanel({
  projectId,
  readOnly = false,
}: {
  projectId: number;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  // ProjectStatusReportSection-тэй ИЖИЛ key + endpoint — нэг кэш.
  const queryKey = ['/projects/status-report', projectId, 'mgl'] as const;
  const query = useApiQuery<StatusReportResponse>(
    queryKey,
    `/projects/${projectId}/status-report?category=mgl`,
    { enabled: !!projectId },
  );

  // Бүтэн report-ыг draft-д барина (PUT бүх талбарыг солидог тул).
  const [draft, setDraft] = useState<ProjectStatusReport>(EMPTY_REPORT);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const res = query.data;
    if (!res || dirty) return;
    const r = res.report
      ? {
          ...res.report,
          funding_milestones: res.report.funding_milestones ?? [],
          nema_done: !!res.report.nema_done,
          health_done: !!res.report.health_done,
          bdc_experts_done: !!res.report.bdc_experts_done,
          bdc_review_done: !!res.report.bdc_review_done,
        }
      : { ...EMPTY_REPORT, project_id: projectId };
    setDraft(r);
  }, [query.data, dirty, projectId]);

  useEffect(() => {
    if (query.error) toast.error('Гадны байгууллага ачаалж чадсангүй', query.error.message);
  }, [query.error]);

  const setNote = (key: AgencyDef['noteKey'], value: string) => {
    if (readOnly) return;
    setDraft((prev) => ({ ...prev, [key]: value || null }));
    setDirty(true);
  };
  const toggleDone = (key: AgencyDef['doneKey']) => {
    if (readOnly) return;
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ report: ProjectStatusReport }>(
        `/projects/${projectId}/status-report`,
        { method: 'PUT', data: draft },
      );
      const fresh: ProjectStatusReport = {
        ...res.report,
        funding_milestones: res.report.funding_milestones ?? [],
        nema_done: !!res.report.nema_done,
        health_done: !!res.report.health_done,
        bdc_experts_done: !!res.report.bdc_experts_done,
        bdc_review_done: !!res.report.bdc_review_done,
      };
      setDraft(fresh);
      setDirty(false);
      // Кэшийг шинэчилнэ — Мэдээлэл таб (ижил key) дахин татахгүйгээр шинэ
      // утгыг авна.
      queryClient.setQueryData(queryKey, (prev: StatusReportResponse | undefined) => ({
        report: fresh,
        notes: prev?.notes ?? [],
      }));
      toast.success('Хадгалагдлаа');
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  };

  const doneCount = useMemo(
    () => AGENCIES.filter((a) => draft[a.doneKey]).length,
    [draft],
  );
  // Эхний дуусаагүй шат = "одоогийн" шат (дэс дараат явц).
  const currentIdx = AGENCIES.findIndex((a) => !draft[a.doneKey]);
  const pct = Math.round((doneCount / AGENCIES.length) * 100);

  const stateChip = saving ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
      <Loader2 className="w-3 h-3 animate-spin" />
      Хадгалж байна
    </span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <CircleDashed className="w-3 h-3" />
      Засваргүй
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="w-3 h-3" />
      Хадгалагдсан
    </span>
  );

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/40 shadow-sm">
        <div className="h-1 w-full bg-primary/70" />
        <CardContent className="py-4 sm:py-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline" className="gap-1.5 text-xs font-semibold px-2.5 py-1">
                <Building2 className="w-3.5 h-3.5" /> ГБ
              </Badge>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">Гадны байгууллагууд</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Дараалсан үе шат · {doneCount}/{AGENCIES.length} дууссан
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!readOnly && stateChip}
              {!readOnly && (
                <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? 'Хадгалж байна…' : 'Хадгалах'}
                </Button>
              )}
            </div>
          </div>
          <Progress value={pct} className="h-2" />
        </CardContent>
      </Card>

      {/* Дэс дараат шатууд (stepper). */}
      <Card className="border-border/40 shadow-sm">
        <CardContent className="py-4">
          <ol className="relative space-y-0">
            {AGENCIES.map((a, idx) => {
              const done = !!draft[a.doneKey];
              const isCurrent = !done && idx === currentIdx;
              const isLast = idx === AGENCIES.length - 1;
              return (
                <li key={a.noteKey} className="relative flex gap-4 pb-6 last:pb-0">
                  {/* Холбогч босоо шугам */}
                  {!isLast && (
                    <span
                      className={cn(
                        'absolute left-[15px] top-9 bottom-0 w-px',
                        done ? 'bg-emerald-500/50' : 'bg-border',
                      )}
                      aria-hidden
                    />
                  )}
                  {/* Дугаар / check */}
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => toggleDone(a.doneKey)}
                    title={done ? 'Хийгдсэн' : 'Хийгдээгүй'}
                    className={cn(
                      'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                      done
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : isCurrent
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border text-muted-foreground bg-background',
                      readOnly ? 'cursor-default' : 'cursor-pointer',
                    )}
                  >
                    {done ? <Check className="h-4 w-4" /> : idx + 1}
                  </button>

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-medium leading-snug',
                          done ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
                        )}
                      >
                        {a.title}
                      </span>
                      {isCurrent && (
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                          Одоогийн шат
                        </Badge>
                      )}
                    </div>
                    <Textarea
                      rows={2}
                      value={(draft[a.noteKey] as string | null) ?? ''}
                      onChange={(e) => setNote(a.noteKey, e.target.value)}
                      placeholder={a.hint}
                      disabled={readOnly}
                      className="text-sm"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
