import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import type { PgpPlan } from '@/shared/types';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Loader2, Plus, Trash2, Target, MessageSquare, Sparkles } from 'lucide-react';
import { toast } from '@/shared/components/Toast';
import { formatDateTime } from '@/shared/lib/time';
import { SaveBar } from '@/shared/components/SaveBar';
import { PgpForm } from './PgpForm';
import { usePgpAutosave } from './usePgpAutosave';

/**
 * «Хөгжлийн төлөвлөгөө» таб — ажилтан өөрийн PGP-г жил бүр бөглөнө (autosave,
 * submit/түгжээгүй). Удирдлагын (admin/senior) санал доор read-only харагдана.
 */
export default function MyPgpSection() {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();

  const plansQuery = useApiQuery<{ plans: PgpPlan[] }>('/pgp/my', { retry: false });
  const plans = useMemo(() => plansQuery.data?.plans ?? [], [plansQuery.data]);

  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [saving, setSaving] = useState(false);

  // Ачаалагдмагц хамгийн сүүлийн (эсвэл сонгосон нь устсан) он руу шилжинэ.
  useEffect(() => {
    if (!plans.length) {
      setSelectedPeriod(null);
      return;
    }
    if (!selectedPeriod || !plans.some((p) => p.period === selectedPeriod)) {
      setSelectedPeriod(plans[0]!.period);
    }
  }, [plans, selectedPeriod]);

  // Шинэ он үүсгэх сонголтууд — одоо, өмнөх, дараа он; аль хэдийн байгааг хасна.
  const candidateYears = useMemo(() => {
    const cy = new Date().getFullYear();
    const existing = new Set(plans.map((p) => p.period));
    return [cy + 1, cy, cy - 1]
      .map(String)
      .filter((y) => !existing.has(y))
      .sort((a, b) => Number(b) - Number(a));
  }, [plans]);

  const selectedPlan = plans.find((p) => p.period === selectedPeriod) ?? null;

  const startCreating = () => {
    setNewYear(candidateYears[0] ?? String(new Date().getFullYear()));
    setCreating(true);
  };

  const createPlan = async () => {
    if (!newYear) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ plan: PgpPlan }>('/pgp', {
        method: 'POST',
        data: { period: newYear },
      });
      await qc.invalidateQueries({ queryKey: ['/pgp/my'] });
      setSelectedPeriod(res.plan.period);
      setCreating(false);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 409 ? t('pgp.exists') : t('common.error');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async (plan: PgpPlan) => {
    if (!window.confirm(t('pgp.deleteConfirm'))) return;
    try {
      await apiFetch(`/pgp/${plan.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['/pgp/my'] });
    } catch {
      toast.error(t('common.error'));
    }
  };

  if (plansQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t('pgp.title')}
            </CardTitle>
            <CardDescription className="mt-1">{t('pgp.description')}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {plans.length > 0 && (
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
              onClick={startCreating}
              disabled={creating || candidateYears.length === 0}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('pgp.newPeriod')}
            </Button>
          </div>
        </div>

        {creating && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
            <select
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
            >
              {candidateYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" onClick={createPlan} disabled={saving || !newYear}>
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              {t('pgp.createForYear', { year: newYear })}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {!selectedPlan ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Target className="h-10 w-10 mb-3 text-muted-subtle" />
            <p className="text-sm font-medium text-foreground">{t('pgp.noPlans')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('pgp.noPlansHint')}</p>
          </div>
        ) : (
          // key={plan.id} — период солигдоход editor-ыг remount хийж autosave
          // state-ийг цэвэр шинэ төлөвлөгөөнд эхлүүлнэ.
          <PgpEditor
            key={selectedPlan.id}
            plan={selectedPlan}
            locale={lang}
            onDelete={() => deletePlan(selectedPlan)}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Нэг PGP-ийн засварлагч (autosave) + удирдлагын санал (read-only).
// ---------------------------------------------------------------------------
function PgpEditor({
  plan,
  locale,
  onDelete,
}: {
  plan: PgpPlan;
  locale: 'mn' | 'en';
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const { answers, setField, status, dirty, lastSavedAt, commit, save } = usePgpAutosave(
    plan.id,
    plan.answers,
    plan.updated_at,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <SaveBar
          status={status}
          dirty={dirty}
          lastSavedAt={lastSavedAt}
          locale={locale}
          onSave={save}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          {t('pgp.deletePlan')}
        </Button>
      </div>

      <PgpForm answers={answers} onChange={setField} onBlur={commit} />

      {/* Удирдлагын санал (feedback) — ажилтанд зөвхөн харах. */}
      <div className="space-y-3 pt-2 border-t border-border/60">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          {t('pgp.feedbackTitle')}
        </h4>
        {plan.comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('pgp.noFeedback')}</p>
        ) : (
          <ul className="space-y-2">
            {plan.comments.map((cm) => (
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
      </div>
    </div>
  );
}
