import { useCallback, useMemo, useState } from 'react';
import { Plus, Ban } from 'lucide-react';

import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Skeleton } from '@/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';

import { curationSourceType } from '../curation';
import {
  ASSISTANT_INTENTS,
  SLOT_INTENTS,
  type AssistantIntent,
  type ExamplesResponse,
  type ExportResponse,
  type ExportRow,
  type RejectResponse,
} from '../types';
import { intentLabel } from '../curation';
import { RejectDialog } from './ReviewDialogs';

/**
 * СУРГАЛТЫН БАГЦ — гараар жишээ нэмэх + (зөвхөн admin) одоогийн багцын тойм.
 *
 * ⚠️ `GET /assistant/export` нь `requireAdmin()`-тэй бөгөөд `pull_and_retrain.py`
 * ЯГ ЭНЭ ХЭЛБЭРИЙГ уншдаг тул түүнийг өөрчлөхгүй — энд зөвхөн УНШИНА.
 * `senior` хүнд жагсаалт харагдахгүй (403 хүсэлт огт явуулахгүй), гэхдээ
 * гараар жишээ нэмэх нь нээлттэй (`POST /assistant/examples` = admin|senior).
 *
 * ⚠️ `enabled: isAdmin` ба `refetch()` нь ХОСООРОО явна.  `refetch()` нь
 * `enabled`-ыг ТООДОГГҮЙ — тиймээс senior гараар жишээ нэмэхэд хамгаалалтгүй
 * `refetch()` нь `requireAdmin()` руу 403 хүсэлт явуулж, амжилттай үйлдлийн
 * дараа алдааны төлөв асаана.  Доорх бүх дуудалт `isAdmin`-аар хаалттай.
 *
 * ⚠️ ЖИШЭЭГ УНТРААХ (P0-D): `POST /assistant/reject` (`example_ids`) нь
 * `review_state='rejected'` + `is_active=0` тавьдаг ЦОРЫН ГАНЦ бичигч бөгөөд
 * түүнд ХЭРЭГЛЭГЧИЙН ГАРЦ БАЙГААГҮЙ — 0195:50-ийн «муу жишээг устгахгүй,
 * унтраа» зорилго бүтээгдэхүүнээс хүрэхгүй байв.  Товч нь энд.
 *
 * ⚠️ ГЭХДЭЭ `GET /assistant/export`-ийн SELECT нь `id`-г БУЦААДАГГҮЙ (хэмжсэн
 * 2026-08-28, `revit.ts`).  `example_ids`-гүйгээр татгалзал илгээх боломжгүй
 * тул товч нь `row.id` ирсэн мөр дээр л гарна.  Сервер `id` нэмэх өдөр энэ
 * файлд ЯМАР Ч засвар шаардахгүй — `ExportRow.id` нь зориуд `optional`.
 */
export function ExamplesTab({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLanguage();

  const [text, setText] = useState('');
  const [intent, setIntent] = useState<AssistantIntent>('submit_progress');
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);

  /** Унтраах гэж буй жишээ (null = цонх хаалттай). */
  const [rejecting, setRejecting] = useState<ExportRow | null>(null);

  const query = useApiQuery<ExportResponse>('/revit/assistant/export', { enabled: isAdmin });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const perIntent = query.data?.per_intent ?? {};
  const perSourceType = query.data?.per_source_type ?? {};
  const needsSlot = SLOT_INTENTS.includes(intent);

  /**
   * ⚠️ `refetch()` нь `enabled: false`-ыг ТООДОГГҮЙ.  senior хүнд
   * `GET /assistant/export` нь `requireAdmin()` тул 403 болно — амжилттай
   * нэмэлтийн дараа улаан алдаа гарч ирнэ.  Тиймээс ЗӨВХӨН admin дуудна.
   */
  const refetchIfAdmin = useCallback(() => {
    if (isAdmin) void query.refetch();
  }, [isAdmin, query]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    try {
      const res = await apiFetch<ExamplesResponse>('/revit/assistant/examples', {
        method: 'POST',
        data: {
          examples: [
            {
              text: trimmed,
              intent,
              slot: needsSlot ? slot.trim() || null : null,
              // ⚠️ ИЛ `'manual'`.  Сервер тал анхдагч тавихаа больсон: эх
              // сурвалжгүй жишээ 400 болно.  Гараар шивсэн мөрийг
              // «ажиглагдсан» гэж бүртгэх нь корпусыг ХУДЛАА болгоно.
              source: 'manual',
              // ⚠️ P0-C.  Машины таамаг ОГТ БАЙХГҮЙ (мөр ажиглагдаагүй) тул
              //    «баталгаажуулах» юм байхгүй — таксономи нь `HUMAN`, энэ нь
              //    0215-ийн `manual → HUMAN` backfill-тэй ЯГ ТААРНА.
              curation_action: 'manual',
              source_type: curationSourceType('manual', null),
            },
          ],
        },
      });
      // Сервер мөрийг шүүсэн байж болно (танихгүй санаа, хоосон бичвэр).
      if (res.added > 0) {
        toast.success(t('assistantCuration.manualDone'));
        setText('');
        setSlot('');
        refetchIfAdmin();
      } else {
        toast.error(t('assistantCuration.actionFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assistantCuration.actionFailed'));
    } finally {
      setBusy(false);
    }
  }, [text, intent, slot, needsSlot, refetchIfAdmin, t]);

  /**
   * ЖИШЭЭГ УНТРААХ — `review_state='rejected'` + `is_active=0`.
   *
   * ⚠️ Мөр УСТАХГҮЙ.  0195:50-ийн зорилго нь «юу яагаад хасагдсаныг мэдэх»
   * бөгөөд `note` нь тэр асуултын ЦОРЫН ГАНЦ хариулт.  Сервер `note`-ыг
   * `COALESCE(?, note)`-ээр бичдэг тул хоосон тэмдэглэл өмнөхийг ДАРАХГҮЙ.
   */
  const rejectExample = useCallback(
    async (row: ExportRow, note: string) => {
      if (row.id == null) return;
      setBusy(true);
      try {
        const res = await apiFetch<RejectResponse>('/revit/assistant/reject', {
          method: 'POST',
          data: { example_ids: [row.id], note: note.trim() || undefined },
        });
        // Серверийн БОДИТ `meta.changes` — илгээсэн тоог БИШ.
        toast.success(
          t('assistantCuration.exampleRejectDone', { count: res.rejected_examples }),
        );
        setRejecting(null);
        refetchIfAdmin();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('assistantCuration.actionFailed'));
      } finally {
        setBusy(false);
      }
    },
    [refetchIfAdmin, t],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('assistantCuration.manualTitle')}</CardTitle>
          <CardDescription>{t('assistantCuration.manualHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assistant-manual-text">{t('assistantCuration.manualTextLabel')}</Label>
            <Input
              id="assistant-manual-text"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('assistantCuration.manualTextPlaceholder')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('assistantCuration.intentLabel')}</Label>
              <Select value={intent} onValueChange={(v) => setIntent(v as AssistantIntent)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSISTANT_INTENTS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {intentLabel(t, i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsSlot ? (
              <div className="space-y-2">
                <Label htmlFor="assistant-manual-slot">{t('assistantCuration.slotLabel')}</Label>
                <Input
                  id="assistant-manual-slot"
                  value={slot}
                  maxLength={64}
                  onChange={(e) => setSlot(e.target.value)}
                  placeholder={t('assistantCuration.slotPlaceholder')}
                />
              </div>
            ) : null}
          </div>
          <Button disabled={busy || text.trim().length === 0} onClick={() => void submit()}>
            <Plus aria-hidden />
            {t('assistantCuration.manualAdd')}
          </Button>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('assistantCuration.corpusTitle')}</CardTitle>
            <CardDescription>{t('assistantCuration.corpusHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.isLoading ? <Skeleton className="h-40 w-full" /> : null}
            {query.isError ? (
              <p className="text-body text-destructive">{t('assistantCuration.loadFailed')}</p>
            ) : null}
            {query.data ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">
                    {t('assistantCuration.corpusCount', { count: query.data.count })}
                  </Badge>
                  {Object.entries(perIntent).map(([k, n]) => (
                    <Badge key={k} variant="outline">
                      {intentLabel(t, k)} · {n}
                    </Badge>
                  ))}
                </div>

                {/* ⚠️ ИТГЭЛИЙН ТАКСОНОМИ.  `UNKNOWN` мөр 0215-ийн бодлогоор
                    сургалтын цөмд ОРОХГҮЙ — тэр тоо өсөж байвал курацийн
                    зам `source_type` илгээхээ больсон гэсэн үг.  Тиймээс
                    түүнийг ЗОРИУД анхааруулах өнгөөр харуулна. */}
                {Object.keys(perSourceType).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(perSourceType).map(([k, n]) => (
                      <Badge key={k} variant={k === 'UNKNOWN' ? 'destructive' : 'secondary'}>
                        {k} · {n}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('assistantCuration.colText')}</TableHead>
                        <TableHead>{t('assistantCuration.intentLabel')}</TableHead>
                        <TableHead>{t('assistantCuration.colSource')}</TableHead>
                        <TableHead>{t('assistantCuration.colSourceType')}</TableHead>
                        <TableHead className="text-right">
                          {t('assistantCuration.colActions')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Багц хэдэн мянган мөр болж чадна — эхний 200-г л
                          зурна.  Бүтнээр нь Python шугам `--pull`-ээр авна. */}
                      {rows.slice(0, 200).map((r, i) => (
                        <TableRow key={r.id ?? `${r.intent}-${i}`}>
                          <TableCell className="max-w-[28rem] break-words">{r.text}</TableCell>
                          <TableCell>{intentLabel(t, r.intent)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{r.source}</Badge>
                          </TableCell>
                          <TableCell>
                            {r.source_type ? (
                              <Badge
                                variant={r.source_type === 'UNKNOWN' ? 'destructive' : 'outline'}
                              >
                                {r.source_type}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {/* ⚠️ `id` ирээгүй бол `example_ids` угсрах
                                БОЛОМЖГҮЙ — товчийг харуулаад 400 өгөхөөс
                                нуух нь ЗӨВ.  Шалтгааныг доор нэг мөрөөр
                                тайлбарлана. */}
                            {r.id != null ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => setRejecting(r)}
                              >
                                <Ban aria-hidden />
                                {t('assistantCuration.reject')}
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {rows.length > 0 && rows.every((r) => r.id == null) ? (
                  <p className="text-micro text-muted-foreground">
                    {t('assistantCuration.exampleRejectUnavailable')}
                  </p>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <RejectDialog
        open={rejecting != null}
        count={rejecting ? 1 : 0}
        busy={busy}
        titleKey="assistantCuration.exampleRejectTitle"
        hintKey="assistantCuration.exampleRejectHint"
        onCancel={() => setRejecting(null)}
        onConfirm={(note) => {
          const row = rejecting;
          if (row) void rejectExample(row, note);
        }}
      />
    </div>
  );
}
