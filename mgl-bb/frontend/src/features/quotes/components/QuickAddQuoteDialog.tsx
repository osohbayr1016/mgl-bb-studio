/**
 * «Хурдан нэмэх» — апп-аас ГАДУУР (Excel дээр) хийгдсэн өмнөх саналыг буцаан
 * бүртгэх форм.
 *
 * ЯАГААД: MGL жилд ~300 санал явуулдаг ба тэдгээрийн ихэнх нь Excel дээр
 * хийгдсэн. Юүлүүр (`QuoteFunnelCard`) тэдгээргүйгээр утга учиргүй — «энэ сард
 * 3 санал явуулсан» гэж харуулна. Энэ форм нь загвар, хувилбар, ажлын дэвтэр
 * огт барихгүйгээр ЗӨВХӨН тоон баримтыг авна.
 *
 * ⚠️ Үүсгэсний дараа засварлагч руу ШИЛЖИХГҮЙ (`POST /`-ээс ялгаатай): эдгээр
 * мөр нь ХООСОН дэвтэртэй тул засварлагч хоосон хуудас харуулна. Мөн ижил
 * шалтгаанаар жагсаалт дээр «PDF татах» товч тэдэнд гарахгүй
 * (`lib/quoteStatus` → `canPrintQuote`).
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, PencilLine } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import type { ProjectOption } from '@/shared/types';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

import { QUOTES_FUNNEL_KEY, QUOTES_LIST_KEY, createManualQuote } from '../api/quotes';
import { QUOTE_STATUS_LABEL } from '../lib/quoteStatus';
import { DEFAULT_VARIANT_KEY, type QuoteVariantKey } from '../lib/quoteVariants';
import { QUOTE_STATUSES, type QuoteStatus } from '../types/quotes';
import { VariantPicker } from './VariantPicker';

/** `Select` нь '' утгыг зөвшөөрдөггүй тул «төсөлгүй»-г sentinel-ээр илэрхийлнэ. */
const NO_PROJECT = 'none';

export function QuickAddQuoteDialog() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilLine />
          {t('quotes.quickAdd')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('quotes.quickAddDialog.title')}</DialogTitle>
        </DialogHeader>
        {/* `key` — хаагаад дахин нээхэд маягт цоо шинээр эхэлнэ. */}
        {open && (
          <QuickAddForm
            onDone={() => {
              qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
              qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickAddForm({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();

  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [docDate, setDocDate] = useState('');
  const [total, setTotal] = useState('');
  const [contract, setContract] = useState('');
  // Буцаан бүртгэж буй санал нь ихэвчлэн аль хэдийн явсан — 'sent' анхдагч.
  const [status, setStatus] = useState<QuoteStatus>('sent');
  const [variantKeys, setVariantKeys] = useState<QuoteVariantKey[]>([DEFAULT_VARIANT_KEY]);

  const projectsQuery = useApiQuery<{ projects: ProjectOption[] }>('/projects', { retry: false });
  const projects = projectsQuery.data?.projects ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createManualQuote({
        title: title.trim(),
        client_name: clientName.trim() || null,
        ...(projectId !== NO_PROJECT ? { project_id: Number(projectId) } : {}),
        ...(docDate ? { doc_date: docDate } : {}),
        total_amount: total.trim() === '' ? null : Number(total),
        // Гэрээний дүн зөвхөн «Гэрээ болсон» дээр утгатай — өөр шатанд илгээвэл
        // гэрээ болоогүй мөнгө юүлүүрт орно.
        contract_amount: status === 'active' && contract.trim() !== '' ? Number(contract) : null,
        status,
        variant_keys: [...variantKeys],
      }),
    onSuccess: () => {
      toast.success(t('quotes.quickAddSaved'));
      onDone();
    },
    onError: (err) =>
      toast.error(t('quotes.createFailed'), err instanceof Error ? err.message : undefined),
  });

  const busy = mutation.isPending;
  const canSave = title.trim().length > 0 && !busy;

  return (
    <>
      <div className="space-y-4 pt-1">
        <p className="text-micro text-muted-foreground">{t('quotes.quickAddDialog.hint')}</p>

        <div className="space-y-2">
          <Label htmlFor="qa-title">{t('quotes.field.title')}</Label>
          <Input
            id="qa-title"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="qa-client">{t('quotes.field.client')}</Label>
            <Input
              id="qa-client"
              value={clientName}
              disabled={busy}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qa-date">{t('quotes.field.docDate')}</Label>
            <Input
              id="qa-date"
              type="date"
              value={docDate}
              disabled={busy}
              onChange={(e) => setDocDate(e.target.value)}
            />
          </div>
        </div>

        <VariantPicker
          id="qa-variants"
          value={variantKeys}
          onChange={setVariantKeys}
          disabled={busy}
        />

        <div className="space-y-2">
          <Label htmlFor="qa-project">{t('quotes.field.project')}</Label>
          <Select value={projectId} onValueChange={setProjectId} disabled={busy}>
            <SelectTrigger id="qa-project" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>{t('quotes.field.noProject')}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="qa-status">{t('quotes.col.status')}</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as QuoteStatus)}
              disabled={busy}
            >
              <SelectTrigger id="qa-status" className="w-full">
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
          <div className="space-y-2">
            <Label htmlFor="qa-total">{t('quotes.col.total')}</Label>
            <Input
              id="qa-total"
              type="number"
              inputMode="decimal"
              value={total}
              disabled={busy}
              onChange={(e) => setTotal(e.target.value)}
            />
          </div>
        </div>

        {status === 'active' && (
          <div className="space-y-2">
            <Label htmlFor="qa-contract">{t('quotes.statusDialog.contractAmount')}</Label>
            <Input
              id="qa-contract"
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
      </div>

      <DialogFooter>
        <Button type="button" disabled={!canSave} onClick={() => mutation.mutate()}>
          {busy && <Loader2 className="animate-spin" />}
          {t('common.create')}
        </Button>
      </DialogFooter>
    </>
  );
}
