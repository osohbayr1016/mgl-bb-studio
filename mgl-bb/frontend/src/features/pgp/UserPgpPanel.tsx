import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import type { PgpPlan, PgpComment } from '@/shared/types';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Textarea } from '@/ui/textarea';
import { FileSpreadsheet, Loader2, Lock, Target, MessageSquare, Send, Sparkles } from 'lucide-react';
import { toast } from '@/shared/components/Toast';
import { formatDateTime } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import { PgpForm } from './PgpForm';
import { exportPgpXlsx, sanitizeFileNamePart, type PgpXlsxRow } from './lib/exportPgpXlsx';

/**
 * Ажилтны PGP-г админ/senior талд харуулах панель (read-only маягт) +
 * санал (feedback) бичих. UserProfileViewPage-ийн «PGP» табд суудаг.
 * userName/teamCode/teamName нь Excel export-ын толгойн мэдээлэлд л
 * хэрэглэгдэнэ (optional — parent профайлаас дамжуулна).
 */
export function UserPgpPanel({
  userId,
  userName,
  teamCode,
  teamName,
}: {
  userId: number;
  userName?: string;
  teamCode?: string | null;
  teamName?: string | null;
}) {
  const { t } = useLanguage();

  const plansQuery = useApiQuery<{ plans: PgpPlan[] }>(
    ['/pgp/user', userId],
    `/pgp/user/${userId}`,
    { enabled: !!userId, retry: false },
  );
  const plans = useMemo(() => plansQuery.data?.plans ?? [], [plansQuery.data]);

  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // Шинэ саналуудыг локал талд нэмэлтээр хадгална (query дахин татах хүртэл).
  const [extraComments, setExtraComments] = useState<Record<number, PgpComment[]>>({});

  useEffect(() => {
    if (!plans.length) {
      setSelectedPeriod(null);
      return;
    }
    if (!selectedPeriod || !plans.some((p) => p.period === selectedPeriod)) {
      setSelectedPeriod(plans[0]!.period);
    }
  }, [plans, selectedPeriod]);

  const forbidden = useMemo(() => {
    const err = plansQuery.error;
    if (!err) return false;
    const msg = err instanceof Error ? err.message : '';
    return msg.toLowerCase().includes('forbid');
  }, [plansQuery.error]);

  const selectedPlan = plans.find((p) => p.period === selectedPeriod) ?? null;

  const [exporting, setExporting] = useState(false);
  // Аль хэдийн татсан plans-ийг ашиглана (сүлжээний дуудлагагүй); энэ
  // session-д бичсэн шинэ саналуудыг (extraComments) хамт оруулна.
  const handleExport = async () => {
    if (exporting || !plans.length) return;
    setExporting(true);
    try {
      const name = formatDisplayName(userName ?? '');
      const rows: PgpXlsxRow[] = plans.map((p) => ({
        name,
        teamCode: teamCode ?? null,
        teamName: teamName ?? null,
        period: p.period,
        updatedAt: p.updated_at,
        answers: p.answers,
        comments: [...p.comments, ...(extraComments[p.id] ?? [])],
      }));
      await exportPgpXlsx({
        fileName: `${t('pgpExport.fileBase')}_${sanitizeFileNamePart(name) || userId}.xlsx`,
        sheetName: t('pgpAuthors.tab'),
        rows,
        t,
      });
    } catch {
      toast.error(t('pgpExport.failed'));
    } finally {
      setExporting(false);
    }
  };

  const submitFeedback = async () => {
    if (!selectedPlan || !note.trim()) return;
    setSending(true);
    try {
      const res = await apiFetch<{ comment: PgpComment }>(`/pgp/${selectedPlan.id}/comments`, {
        method: 'POST',
        data: { note: note.trim() },
      });
      setExtraComments((prev) => ({
        ...prev,
        [selectedPlan.id]: [...(prev[selectedPlan.id] ?? []), res.comment],
      }));
      setNote('');
      toast.success(t('pgp.feedbackSaved'));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('common.error');
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  if (plansQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="py-10 text-center">
          <Lock className="h-8 w-8 mx-auto mb-3 text-muted-subtle" />
          <p className="text-sm font-medium text-foreground">{t('userProfileViewPage.noAccess')}</p>
        </CardContent>
      </Card>
    );
  }

  if (!selectedPlan) {
    return (
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="py-14 text-center">
          <Target className="h-10 w-10 mx-auto mb-3 text-muted-subtle" />
          <p className="text-sm font-medium text-foreground">{t('pgp.empty')}</p>
        </CardContent>
      </Card>
    );
  }

  const comments = [...selectedPlan.comments, ...(extraComments[selectedPlan.id] ?? [])];

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <div className="px-5 py-4 border-b border-border/60 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {t('pgp.title')}
          <span className="text-label text-muted-foreground border border-border rounded-full px-2 py-0.5">
            {t('pgp.readOnly')}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {plans.length > 1 && (
            <select
              value={selectedPeriod ?? ''}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
              aria-label={t('pgp.selectYear')}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.period}>
                  {p.period}
                </option>
              ))}
            </select>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            )}
            {t('pgpExport.button')}
          </Button>
        </div>
      </div>

      <CardContent className="space-y-6 pt-5">
        <p className="text-xs text-muted-foreground">
          {t('pgp.lastUpdated', { date: formatDateTime(selectedPlan.updated_at) })}
        </p>

        <PgpForm answers={selectedPlan.answers} readOnly />

        {/* Санал (feedback) — админ/senior бичнэ. */}
        <div className="space-y-3 pt-2 border-t border-border/60">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            {t('pgp.feedbackTitle')}
          </h4>
          {comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('pgp.noFeedback')}</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((cm) => (
                <li key={cm.id} className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {cm.author_name ?? '—'}
                    </span>
                    <span className="text-micro text-muted-foreground">
                      {formatDateTime(cm.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{cm.note}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <Textarea
              value={note}
              rows={3}
              placeholder={t('pgp.feedbackPlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={submitFeedback} disabled={sending || !note.trim()}>
                {sending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                {t('pgp.send')}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
