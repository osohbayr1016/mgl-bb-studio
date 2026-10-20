import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Alert, AlertDescription } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Skeleton } from '@/ui/skeleton';

import {
  TICKER_ADMIN_QUERY_KEY,
  createTickerMessage,
  deleteTickerMessage,
  fetchTickerAdmin,
  mergeRows,
  resetTickerBuiltin,
  saveTickerOrder,
  updateTickerBuiltin,
  updateTickerMessage,
  type TickerFieldPatch,
  type TickerRow,
} from './api';
import { TickerRowCard } from './components/TickerRowCard';

/**
 * «Гүйдэг мэдээ» — толгойн зурвасын админ удирдлага.  Тохиргоо хуудасны
 * (`/app/settings?section=settings-ticker`) нэг карт; 2026-09-18 хүртэл
 * sidebar-т тусдаа `/app/admin/ticker` хуудас байсан — эзний хүсэлтээр
 * тохиргоо руу нүүсэн, хуучин зам нь энэ хэсэг рүү redirect хийнэ.
 *
 * Толгой дээр гүйдэг капсулууд ХОЁР эх сурвалжтай (migration 0255):
 * кодоор угсрагддаг ес (ирц, баяр, эрсдэл …) ба админаас бичсэн чөлөөт
 * мэдээ.  Энэ карт хоёуланг нь НЭГ жагсаалтад, толгой дээр гарах яг
 * тэр дарааллаар нь харуулж, дараах үйлдлүүдийг өгнө: асаах/унтраах,
 * текст-шошго-өнгийг дарж бичих, эрэмбэ солих, шинэ мэдээ нэмэх/устгах.
 *
 * ⚠️ Эрх: ЗӨВХӨН admin.  `SettingsPage` энэ хэсгийг admin-д л нэмдэг ба
 *    query нь `enabled: role === 'admin'` — гэхдээ жинхэнэ хаалга нь
 *    backend-ийн `requireAdmin()` (`routes/ticker.ts`-ийн `/admin/*`).
 *
 * ⚠️ Хадгалсны дараа `['/ticker']` кэшийг МӨН хүчингүй болгоно — эс бөгөөс
 *    админ өөрчлөлтөө толгой дээрээ 60 секунд (`staleTime`) хүлээж
 *    харна.
 */

/** Хараахан хадгалагдаагүй, шинээр бичиж буй мөрийн хоосон загвар. */
const BLANK_ROW: TickerRow = {
  kind: 'message',
  id: 'm-new',
  rank: 0,
  message: {
    id: 0,
    text_mn: '',
    text_en: null,
    tag_mn: null,
    tag_en: null,
    tone: 'default',
    href: null,
    is_active: 1,
    starts_on: null,
    ends_on: null,
    sort_order: 0,
    created_at: null,
    updated_at: null,
  },
};

const rowRef = (r: TickerRow): { kind: 'builtin' | 'message'; key: string | number } =>
  r.kind === 'builtin' ? { kind: 'builtin', key: r.builtin.key } : { kind: 'message', key: r.message.id };

export function TickerAdminCard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: TICKER_ADMIN_QUERY_KEY,
    queryFn: fetchTickerAdmin,
    enabled: user?.role === 'admin',
  });

  /**
   * Бүх бичих үйлдлийг НЭГ mutation-аар — дуудлага бүр өөрийн функцээ
   * дамжуулна.  Ингэснээр «завгүй» төлөв нэг, кэш цэвэрлэх дүрэм нэг
   * газар байна (зургаан бараг ижил `useMutation` блокийн оронд).
   */
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: TICKER_ADMIN_QUERY_KEY });
      // Толгойн зурвасын кэш — өөрчлөлт тэр дороо харагдах ёстой.
      void qc.invalidateQueries({ queryKey: ['/ticker'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const rows = mergeRows(data);

  /** Дээш/доош — жагсаалтыг бүхэлд нь дахин дугаарлаж сервер рүү илгээнэ. */
  const move = (index: number, dir: -1 | 1) => {
    const next = [...rows];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[index];
    const b = next[j];
    if (!a || !b) return;
    next[index] = b;
    next[j] = a;
    run.mutate(() => saveTickerOrder(next.map(rowRef)));
  };

  const save = (row: TickerRow, patch: TickerFieldPatch) => {
    if (row.kind === 'builtin') {
      run.mutate(() => updateTickerBuiltin(row.builtin.key, patch));
    } else {
      run.mutate(() => updateTickerMessage(row.message.id, patch));
    }
  };

  const toggle = (row: TickerRow, active: boolean) => {
    if (row.kind === 'builtin') {
      run.mutate(() => updateTickerBuiltin(row.builtin.key, { is_active: active }));
    } else {
      run.mutate(() => updateTickerMessage(row.message.id, { is_active: active }));
    }
  };

  const remove = async (id: number) => {
    const ok = await confirmDialog({
      description: t('tickerAdmin.deleteConfirm'),
      variant: 'destructive',
    });
    if (ok) run.mutate(() => deleteTickerMessage(id));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary-ink" aria-hidden />
          {t('tickerAdmin.title')}
        </CardTitle>
        <CardDescription>{t('tickerAdmin.subtitle')}</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="mr-1 h-4 w-4" />
            {t('tickerAdmin.add')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {adding && (
              <TickerRowCard
                row={BLANK_ROW}
                isNew
                busy={run.isPending}
                onCancel={() => setAdding(false)}
                onSave={(patch) =>
                  run.mutate(() => createTickerMessage(patch), {
                    onSuccess: () => setAdding(false),
                  })
                }
              />
            )}

            {rows.map((row, i) => (
              <TickerRowCard
                key={row.id}
                row={row}
                first={i === 0}
                last={i === rows.length - 1}
                busy={run.isPending}
                onMove={(dir) => move(i, dir)}
                onToggleActive={(v) => toggle(row, v)}
                onSave={(patch) => save(row, patch)}
                onDelete={row.kind === 'message' ? () => void remove(row.message.id) : undefined}
                onReset={
                  row.kind === 'builtin'
                    ? () => run.mutate(() => resetTickerBuiltin(row.builtin.key))
                    : undefined
                }
              />
            ))}
          </div>
        )}

        <p className="text-micro text-muted-foreground">{t('tickerAdmin.footnote')}</p>
      </CardContent>
    </Card>
  );
}
