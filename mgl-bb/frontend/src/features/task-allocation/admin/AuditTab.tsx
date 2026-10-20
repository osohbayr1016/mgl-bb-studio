/* Инвариантын аудит (2026-10-05, зөвхөн УНШИХ).  Release-ийн хаалга: «paused» дээр хөрвүүлж, аудит `errors = 0` болсны ДАРАА л
 * идэвхжүүлнэ.  Код бүрийн ТОО бүхлээрээ, жагсаалт нь хэсэгчилсэн (truncated). */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2, SearchCheck, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { ResponsiveTable } from '@/ui/responsive-table';
import { useLanguage } from '@/shared/i18n';

import { adminErrorText, fetchAudit, type AuditFinding, type AuditReport } from './adminApi';
import { dateTime } from './format';

const WARN_CODES = new Set([
  'COMPLETED_FLAG_MISSING',
  'POST_COMMIT_STUCK',
  'FUTURE_WORK_INACTIVE',
  'CREDIT_DRIFT',
  'CONVERSION_ROOT_WEIGHT_CHANGED',
]);

export function AuditTab() {
  const { t } = useLanguage();
  const [deep, setDeep] = useState(false);
  const [project, setProject] = useState('');
  const [report, setReport] = useState<AuditReport | null>(null);
  const projectId = /^[0-9]+$/.test(project.trim()) ? Number(project.trim()) : null;
  const run = useMutation({
    mutationFn: () => fetchAudit({ deep, projectId }),
    onSuccess: setReport,
  });

  const codes = report ? Object.entries(report.counts).sort((a, b) => Number(WARN_CODES.has(a[0])) - Number(WARN_CODES.has(b[0])) || b[1] - a[1]) : [];

  return (
    <div className="space-y-4" data-testid="alloc-admin-audit">
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">{t('taskAllocAdmin.audit.intro')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="audit-project" className="block text-xs font-medium">
              {t('taskAllocAdmin.audit.project')}
            </label>
            <Input
              id="audit-project"
              inputMode="numeric"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder={t('taskAllocAdmin.audit.projectAll')}
              className="w-44"
              data-testid="audit-project"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox checked={deep} onCheckedChange={(v) => setDeep(v === true)} data-testid="audit-deep" />
            {t('taskAllocAdmin.audit.deep')}
          </label>
          <Button type="button" onClick={() => run.mutate()} disabled={run.isPending || (project.trim() !== '' && projectId === null)} data-testid="audit-run">
            {run.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <SearchCheck aria-hidden />}
            {t('taskAllocAdmin.audit.run')}
          </Button>
        </div>
        {deep && <p className="text-xs text-muted-foreground">{t('taskAllocAdmin.audit.deepHint')}</p>}
      </Card>

      {run.isError && (
        <Alert variant="destructive">
          <AlertTitle>{t('taskAllocAdmin.audit.failed')}</AlertTitle>
          <AlertDescription>{adminErrorText(run.error, '')}</AlertDescription>
        </Alert>
      )}

      {report && (
        <>
          <Alert variant={report.ok ? 'default' : 'destructive'} data-testid="audit-verdict" data-ok={report.ok ? '1' : '0'}>
            {report.ok ? <CheckCircle2 aria-hidden /> : <TriangleAlert aria-hidden />}
            <AlertTitle>{report.ok ? t('taskAllocAdmin.audit.clean') : t('taskAllocAdmin.audit.dirty', { n: String(report.errors) })}</AlertTitle>
            <AlertDescription>
              <span className="block">
                {t('taskAllocAdmin.audit.summary', { roots: String(report.roots_checked), warn: String(report.warnings), at: dateTime(report.generated_at) })}
              </span>
              {/* Ногоон «алдаагүй» нь ЯМАР хүрээнд гэдгийг үргэлж харуулна — төслөөр нарийчилсан шалгалт бүх системийн дүн мэт харагдахгүй. */}
              <span className="block" data-testid="audit-scope">
                {t('taskAllocAdmin.audit.scope', {
                  project: report.scope.project_id ? t('taskAllocAdmin.audit.scopeProject', { n: String(report.scope.project_id) }) : t('taskAllocAdmin.audit.scopeAllProjects'),
                  mode: report.scope.deep ? t('taskAllocAdmin.audit.scopeDeep') : t('taskAllocAdmin.audit.scopeShallow'),
                })}
              </span>
            </AlertDescription>
          </Alert>

          {codes.length > 0 && (
            <Card className="space-y-2 p-4">
              <h3 className="text-sm font-semibold">{t('taskAllocAdmin.audit.byCode')}</h3>
              <ul className="divide-y divide-border" data-testid="audit-codes">
                {codes.map(([code, n]) => (
                  <li key={code} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{code}</p>
                      <p className="text-xs text-muted-foreground">{t(`taskAllocAdmin.audit.code.${code}`)}</p>
                    </div>
                    <Badge variant={WARN_CODES.has(code) ? 'secondary' : 'destructive'} className="tabular-nums">
                      {n}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {report.findings.length > 0 && (
            <Card className="space-y-2 p-4">
              <h3 className="text-sm font-semibold">
                {t('taskAllocAdmin.audit.findings', { n: String(report.findings.length) })}
                {report.truncated && <span className="ml-2 text-xs font-normal text-muted-foreground">{t('taskAllocAdmin.audit.truncated')}</span>}
              </h3>
              <ResponsiveTable<AuditFinding>
                rows={report.findings}
                rowKey={(f) => `${f.code}:${f.task_id ?? 0}:${f.user_id ?? 0}:${f.message}`}
                columns={[
                  { id: 'sev', header: t('taskAllocAdmin.col.severity'), cell: (f) => <Badge variant={f.severity === 'error' ? 'destructive' : 'secondary'}>{t(`taskAllocAdmin.audit.sev.${f.severity}`)}</Badge> },
                  { id: 'code', header: t('taskAllocAdmin.col.code'), cell: (f) => <span className="font-mono text-xs">{f.code}</span>, hideOnMobile: true },
                  { id: 'task', header: t('taskAllocAdmin.col.task'), cell: (f) => (f.task_id ? `#${f.task_id}` : '—') },
                  { id: 'msg', header: t('taskAllocAdmin.col.message'), cell: (f) => <span className="text-sm">{f.message}</span> },
                ]}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default AuditTab;
