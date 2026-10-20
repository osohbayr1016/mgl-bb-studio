/**
 * Юүлүүрийн шат солих диалог + шилжилтийн түүх.
 *
 * Статусыг ЗӨВХӨН эндээс солино — `saveQuote` (autosave) нь статус хөнддөггүй,
 * эс бөгөөс дэвтэр хадгалах бүрд юүлүүр чимээгүйхэн хөдөлнө.
 *
 * `active` (гэрээ болсон) руу шилжихэд ГЭРЭЭНИЙ дүнг асууна: тэр нь саналын
 * дүнгээс өөр байдаг (хэлэлцээрийн дараа). Сервер өгөгдмөлөөр `total_amount`
 * -оор дүүргэдэг ч энэ талбар PM-д гараар засах боломж өгнө.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Textarea } from '@/ui/textarea';

import {
  QUOTES_FUNNEL_KEY,
  QUOTES_LIST_KEY,
  getQuoteStatusHistory,
  quoteHistoryKey,
  setQuoteStatus,
} from '../api/quotes';
import { QUOTE_STATUSES, type QuoteListItem, type QuoteStatus } from '../types/quotes';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { QUOTE_STATUS_LABEL } from '../lib/quoteStatus';

export function QuoteStatusDialog({
  quote,
  open,
  onOpenChange,
}: {
  quote: QuoteListItem | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('quotes.statusDialog.title')}</DialogTitle>
        </DialogHeader>
        {/*
          ⚠️ `key` нь ЗОРИУДЫН: маягтын эхний утгууд (шинэ төлөв, гэрээний дүн)
          саналаас гардаг тул өөр санал сонгоход бүрэлдэхүүнийг ДАХИН УГСРАХ
          хэрэгтэй. Үүнийг `useEffect`-ээр setState хийж «дахин суулгах» нь
          cascading render үүсгэдэг (react-hooks/set-state-in-effect) бөгөөд
          өмнөх саналын дүн үлдэх эрсдэлтэй.
        */}
        {quote && <StatusForm key={quote.id} quote={quote} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function StatusForm({ quote, onDone }: { quote: QuoteListItem; onDone: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();

  // Ноорог → «Илгээсэн» нь хамгийн түгээмэл дараагийн алхам; аль хэдийн
  // илгээсэн саналын хувьд «Гэрээ болсон».
  const [status, setStatus] = useState<QuoteStatus>(quote.status === 'draft' ? 'sent' : 'active');
  const [contract, setContract] = useState(
    quote.contract_amount !== null
      ? String(quote.contract_amount)
      : quote.total_amount !== null
        ? String(quote.total_amount)
        : '',
  );
  const [note, setNote] = useState('');

  // Диалог нээгдсэн үед л энэ бүрэлдэхүүн mount болдог тул нэмэлт `enabled`
  // хамгаалалт шаардлагагүй.
  const historyQuery = useQuery({
    queryKey: quoteHistoryKey(quote.id),
    queryFn: () => getQuoteStatusHistory(quote.id),
  });

  const mutation = useMutation({
    mutationFn: () =>
      setQuoteStatus(quote.id, {
        status,
        note: note.trim() || null,
        // Зөвхөн `active` дээр дүн илгээнэ — өөр шатанд гэрээний дүн бичих нь
        // «гэрээ болоогүй мөнгө» гэсэн утгагүй тоо үүсгэнэ.
        ...(status === 'active' && contract.trim() !== ''
          ? { contract_amount: Number(contract) }
          : {}),
      }),
    onSuccess: () => {
      // Статус солиход жагсаалт ба юүлүүр хоёулаа хоцордог. Түүхийг энд
      // цэвэрлэх шаардлагагүй — маягт хаагдаж, дараагийн нээлтэд шинээр татна.
      qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
      qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
      onDone();
      toast.success(t('quotes.statusChanged'));
    },
    onError: (err) => {
      // Сервер 409-ийг хоёр шалтгаанаар буцаана — тус тусад нь тайлбарлана.
      const code = err instanceof ApiError ? (err.code ?? '') : '';
      const message =
        code === 'SAME_STATUS'
          ? t('quotes.err.sameStatus')
          : code === 'STALE_STATUS'
            ? t('quotes.err.staleStatus')
            : err instanceof Error
              ? err.message
              : undefined;
      toast.error(t('quotes.statusFailed'), message);
    },
  });

  const busy = mutation.isPending;
  const history = historyQuery.data ?? [];

  return (
    <>
      <div className="space-y-4 pt-1">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="truncate font-medium text-foreground">{quote.title || '—'}</span>
          <QuoteStatusBadge status={quote.status} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="quote-status">{t('quotes.statusDialog.newStatus')}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as QuoteStatus)} disabled={busy}>
            <SelectTrigger id="quote-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUOTE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(QUOTE_STATUS_LABEL[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {status === 'active' && (
          <div className="space-y-2">
            <Label htmlFor="quote-contract">{t('quotes.statusDialog.contractAmount')}</Label>
            <Input
              id="quote-contract"
              type="number"
              inputMode="decimal"
              value={contract}
              disabled={busy}
              onChange={(e) => setContract(e.target.value)}
            />
            <p className="text-micro text-muted-foreground">
              {t('quotes.statusDialog.contractHint')}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="quote-status-note">{t('quotes.statusDialog.note')}</Label>
          <Textarea
            id="quote-status-note"
            rows={2}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {history.length > 0 && (
          <div className="space-y-1">
            <p className="text-micro font-semibold text-muted-foreground">
              {t('quotes.statusDialog.history')}
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {history.map((h) => (
                <li key={h.id} className="text-micro text-muted-foreground">
                  <span className="tabular-nums">{h.changed_at}</span>
                  {' · '}
                  {h.from_status ? t(QUOTE_STATUS_LABEL[h.from_status]) : '—'}
                  {' → '}
                  <span className="font-medium text-foreground">
                    {t(QUOTE_STATUS_LABEL[h.to_status])}
                  </span>
                  {h.changed_by_name ? ` · ${h.changed_by_name}` : ''}
                  {h.note ? ` · ${h.note}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button type="button" disabled={busy} onClick={() => mutation.mutate()}>
          {busy && <Loader2 className="animate-spin" />}
          {t('common.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
