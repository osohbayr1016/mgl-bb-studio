import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Save, Printer, Loader2, CheckCircle2, CircleDashed } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { AccordionForm } from '@/features/projects/team-reports/AccordionForm';
import type { SectionDef, TeamReportAnswers } from '@/features/projects/team-reports/types';

/* =============================================================
 * ProjectSectionPanel — ерөнхий project-level (баг бус) тайлбар
 * бичгийн хэсэг.
 * -------------------------------------------------------------
 * Багуудаас давхардсан сэдвийг (Техникийн өрөө+UPS, Галын
 * аюулгүй байдал) нэгтгэсэн төслийн нэгдсэн хэсэг. Норм-той ижил
 * зарчмаар синтетик team_code-оор project_team_reports-д
 * хадгална (migration шаардлагагүй). TeamReportShell-ийг
 * АШИГЛАХГҮЙ (тэр нь статус асуулт/stats/correspondence-ийг
 * үргэлж нэмдэг) — зөвхөн AccordionForm-оор асуумжийг рендэрлэнэ.
 * ============================================================= */

export interface ProjectSectionPanelProps {
  projectId: number;
  /** Синтетик team_code, ж: 'ROOMS' | 'FIRE'. */
  code: string;
  title: string;
  /** Hero badge-ийн богино тэмдэг (ж: 'ТӨ'). */
  badge: string;
  sections: SectionDef[];
  readOnly?: boolean;
}

interface SectionReportResponse {
  report: { answers: TeamReportAnswers | null } | null;
}

export function ProjectSectionPanel({
  projectId,
  code,
  title,
  badge,
  sections,
  readOnly = false,
}: ProjectSectionPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = ['/projects/team-reports', projectId, code] as const;
  const reportQuery = useApiQuery<SectionReportResponse>(
    queryKey,
    `/projects/${projectId}/team-reports/${code}`,
    { enabled: !!projectId },
  );

  const [answers, setAnswers] = useState<TeamReportAnswers>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed from server unless the user has unsaved edits (mirror TeamReportShell).
  useEffect(() => {
    const r = reportQuery.data?.report;
    if (!r || dirty) return;
    setAnswers((r.answers ?? {}) as TeamReportAnswers);
  }, [reportQuery.data, dirty]);

  useEffect(() => {
    if (reportQuery.error) toast.error(`${title} ачаалж чадсангүй`, reportQuery.error.message);
  }, [reportQuery.error, title]);

  const onChange = (patch: Partial<TeamReportAnswers>) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ report: { answers: TeamReportAnswers | null } }>(
        `/projects/${projectId}/team-reports/${code}`,
        { method: 'PUT', data: { building_type: null, answers } },
      );
      if (res.report) setAnswers((res.report.answers ?? {}) as TeamReportAnswers);
      setDirty(false);
      queryClient.setQueryData(queryKey, { report: res.report });
      queryClient.invalidateQueries({ queryKey: ['/projects/team-reports', projectId] });
      toast.success('Хадгалагдлаа');
    } catch (e) {
      toast.error('Хадгалж чадсангүй', e instanceof Error ? e.message : 'Алдаа гарлаа');
    } finally {
      setSaving(false);
    }
  };

  const openPrintView = () => {
    if (dirty) {
      toast.warn('Эхлээд хадгална уу', 'Хэвлэхээс өмнө өөрчлөлтүүдээ хадгалах шаардлагатай.');
      return;
    }
    window.open(
      `/app/projects/${projectId}/team-reports/${code}/print?mode=client`,
      '_blank',
      'noopener',
    );
  };

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
        <CardContent className="py-4 sm:py-5">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline" className="text-xs font-semibold px-2.5 py-1">
                {badge}
              </Badge>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">{title}</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Төслийн хэмжээнд нэг удаа бөглөнө
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!readOnly && stateChip}
              <Button type="button" size="sm" variant="outline" onClick={openPrintView}>
                <Printer className="w-4 h-4 mr-1.5" /> Тайлан харах
              </Button>
              {!readOnly && (
                <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? 'Хадгалж байна…' : 'Хадгалах'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {reportQuery.isLoading && !reportQuery.data ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      ) : (
        <AccordionForm
          sections={sections}
          answers={answers}
          variant={null}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}
    </div>
  );
}
