import { useState } from 'react';
import {
  BadgeCheck,
  Briefcase,
  Copy,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Pencil,
  Phone,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { toast } from '@/shared/components/Toast';
import type { ContractKind, EmployeeHrResponse } from '../types';
import { fetchContractBlobUrl, uploadContractFile, useDeleteContractFile, useEmployeeHr } from '../api';
import { fmtBytes } from '../lib/format';
import { HrEditDialog } from './HrEditDialog';
import { useQueryClient } from '@tanstack/react-query';

/**
 * HR карт — гэрээ, ажилд орсон огноо, PC нэвтрэлт (ил текст, эзний шийдвэр),
 * үнэлгээ, PGP, чөлөө.  Зөвхөн admin (route өөрөө хаалттай).
 */
export function HrCard({ userId }: { userId: number }) {
  const { t } = useLanguage();
  const { data, isLoading, isError } = useEmployeeHr(userId);
  const [editOpen, setEditOpen] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [uploading, setUploading] = useState<ContractKind | null>(null);
  const delEmployment = useDeleteContractFile(userId, 'employment');
  const delNda = useDeleteContractFile(userId, 'nda');
  const qc = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/reports/employees', userId, 'hr'] });

  const onUpload = async (kind: ContractKind, file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    try {
      await uploadContractFile(userId, kind, file);
      await invalidate();
      toast.success(t('reportsPage.hrSaved'));
    } catch (err) {
      toast.error(t('reportsPage.upload'), err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(null);
    }
  };

  const openPdf = async (kind: ContractKind) => {
    try {
      const url = await fetchContractBlobUrl(userId, kind);
      const w = window.open(url, '_blank', 'noopener');
      if (!w) toast.error(t('reportsPage.viewPdf'));
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(t('reportsPage.viewPdf'), err instanceof Error ? err.message : undefined);
    }
  };

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast.success(t('reportsPage.copied'));
    } catch {
      toast.error(t('reportsPage.copy'));
    }
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          {isError ? (
            <span className="text-sm text-danger">{t('reportsPage.loadError')}</span>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
        </CardContent>
      </Card>
    );
  }

  const hr = data.hr;

  return (
    <Card id="sec-reports-hr" className="scroll-mt-24">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4 text-primary" />
            {t('reportsPage.hrTitle')}
          </CardTitle>
          <CardDescription className="flex items-center gap-1 text-xs">
            <ShieldAlert className="h-3 w-3" />
            {t('reportsPage.hrHint')}
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t('reportsPage.hrEdit')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {/* ── Ажилд орсон / гэрээ ── */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('reportsPage.contract')}</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Row label={t('reportsPage.hiredAt')} value={hr?.hired_at} />
            <Row label={t('reportsPage.registeredAt')} value={data.user.created_at.slice(0, 10)} muted />
          </dl>

          {/* ── Гэрээний файлууд — ХОЁР тусдаа: Хөдөлмөрийн + Нууцлалын (эзний хүсэлт 2026-09-16) ── */}
          <div className="space-y-2 rounded-lg border border-border p-2.5">
            <ContractFileRow
              title={t('reportsPage.contractEmployment')}
              fileName={hr?.contract_file_name ?? null}
              fileSize={hr?.contract_file_size ?? null}
              uploadedAt={hr?.contract_uploaded_at ?? null}
              has={!!hr?.has_contract_file}
              uploading={uploading === 'employment'}
              deleting={delEmployment.isPending}
              onOpen={() => openPdf('employment')}
              onUpload={(f) => onUpload('employment', f)}
              onDelete={() => delEmployment.mutate()}
            />
            <ContractFileRow
              title={t('reportsPage.contractNda')}
              fileName={hr?.nda_file_name ?? null}
              fileSize={hr?.nda_file_size ?? null}
              uploadedAt={hr?.nda_uploaded_at ?? null}
              has={!!hr?.has_nda_file}
              uploading={uploading === 'nda'}
              deleting={delNda.isPending}
              onOpen={() => openPdf('nda')}
              onUpload={(f) => onUpload('nda', f)}
              onDelete={() => delNda.mutate()}
            />
            <p className="text-[10px] text-muted-foreground">{t('reportsPage.pdfOnly')}</p>
          </div>
        </section>

        {/* ── PC нэвтрэлт + утас ── */}
        <section className="space-y-2">
          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            {t('reportsPage.pcLogin')}
          </h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t('reportsPage.pcUsername')}</dt>
            <dd className="flex items-center gap-1 font-mono">
              {hr?.pc_username ?? <span className="text-muted-foreground">—</span>}
              {hr?.pc_username && <CopyBtn onClick={() => copy(hr.pc_username!)} label={t('reportsPage.copy')} />}
            </dd>
            <dt className="text-muted-foreground">{t('reportsPage.pcPassword')}</dt>
            <dd className="flex items-center gap-1 font-mono">
              {hr?.pc_password ? (
                <>
                  <span className={cn(!showPw && 'select-none tracking-widest')}>{showPw ? hr.pc_password : '••••••••'}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t('reportsPage.hidePassword') : t('reportsPage.showPassword')}
                  >
                    {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <CopyBtn onClick={() => copy(hr.pc_password!)} label={t('reportsPage.copy')} />
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
            <dt className="flex items-center gap-1 text-muted-foreground">
              <Phone className="h-3 w-3" />
              {t('reportsPage.phone')}
            </dt>
            <dd className="tabular-nums">{hr?.phone ?? <span className="text-muted-foreground">—</span>}</dd>
            <Row label={t('reportsPage.position')} value={data.user.position} />
            <Row label={t('reportsPage.seniority')} value={data.user.seniority} />
          </dl>
          {hr?.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">{hr.notes}</p>}
          {hr && (
            <p className="text-[10px] text-muted-foreground">
              {t('reportsPage.hrSaved')}: {formatDateTime(hr.updated_at)}
            </p>
          )}
        </section>

        {/* ── Үнэлгээ / PGP (чөлөө нь цонхыг дагадаг тул EmployeeTab-ын Ирц картад) ── */}
        <section className="space-y-2 md:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <BadgeCheck className="h-3 w-3" />
                {t('reportsPage.assessments')}
              </h4>
              {data.assessments.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('reportsPage.assessmentsEmpty')}</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {data.assessments.slice(0, 4).map((a) => (
                    <li key={a.round_id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                      <span className="truncate">
                        <span className="font-medium">{a.period}</span> · {a.round_name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                        {a.level && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${a.level.color}22`, color: a.level.color }}>
                            {a.level.label}
                          </span>
                        )}
                        {a.overall_pct != null && <span className="font-semibold">{a.overall_pct}%</span>}
                        <span className="text-muted-foreground">
                          {a.self_pct != null && `${t('reportsPage.assessSelf')} ${a.self_pct}`}
                          {a.self_pct != null && a.senior_pct != null && ' · '}
                          {a.senior_pct != null && `${t('reportsPage.assessSenior')} ${a.senior_pct}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('reportsPage.pgp')}</h4>
              {data.pgp.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('reportsPage.pgpEmpty')}</p>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {data.pgp.map((p) => (
                    <li key={p.id}>
                      <Badge variant="outline" className="text-[11px]">
                        {p.period}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </CardContent>

      <HrEditDialog open={editOpen} onOpenChange={setEditOpen} userId={userId} data={data} />
    </Card>
  );
}

function Row({ label, value, muted }: { label: string; value: string | null | undefined; muted?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', muted && 'text-muted-foreground')}>{value || <span className="text-muted-foreground">—</span>}</dd>
    </>
  );
}

/** Нэг гэрээний файлын мөр — нэр/хэмжээ/огноо, үзэх, солих, устгах. */
function ContractFileRow({
  title,
  fileName,
  fileSize,
  uploadedAt,
  has,
  uploading,
  deleting,
  onOpen,
  onUpload,
  onDelete,
}: {
  title: string;
  fileName: string | null;
  fileSize: number | null;
  uploadedAt: string | null;
  has: boolean;
  uploading: boolean;
  deleting: boolean;
  onOpen: () => void;
  onUpload: (file: File | undefined) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="flex min-w-[9rem] items-center gap-1 font-medium">
        <FileText className={cn('h-3.5 w-3.5', has ? 'text-primary' : 'text-muted-foreground')} />
        {title}
      </span>
      <span className="flex flex-1 flex-wrap items-center gap-1.5">
        {has ? (
          <>
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-primary hover:underline">
              <span className="max-w-[14rem] truncate">{fileName}</span>
            </button>
            <span className="text-[11px] text-muted-foreground">
              {fmtBytes(fileSize)}
              {uploadedAt && ` · ${uploadedAt.slice(0, 10)}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-danger"
              disabled={deleting}
              onClick={() => {
                if (window.confirm(t('reportsPage.deleteFileConfirm'))) onDelete();
              }}
              aria-label={t('reportsPage.deleteFile')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">{t('reportsPage.noFile')}</span>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {uploading ? t('reportsPage.uploading') : has ? t('reportsPage.replaceFile') : t('reportsPage.upload')}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              onUpload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </span>
    </div>
  );
}

function CopyBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onClick} aria-label={label}>
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

export type { EmployeeHrResponse };
