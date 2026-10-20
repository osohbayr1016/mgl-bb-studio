import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';

/** `/project-summaries` ба `GET /projects/:id`-ийн `project` — засах цонхонд хэрэгтэй хэсэг. */
export interface AsrProjectNameTarget {
  id: number;
  /** `projects.name` — анхны нэр. */
  base_name: string;
  /** Одоо хадгалагдсан ЗХ-ийн нэр (null = анхны нэрээр харагдаж байна). */
  asr_name: string | null;
  /** Одоо хадгалагдсан төслийн ЗХ-ийн гэрээний дугаар (0365; null = байхгүй). */
  asr_contract_no?: string | null;
}

/**
 * ЗХ-д харагдах төслийн нэр + «Гэрээний дугаар»-ыг засах (нэр: миграц 0358,
 * эзний шийдвэр 2026-09-29; гэрээний дугаар: 0365, 2026-09-30).
 * Зөвхөн админ — сервер `PATCH /author-supervision/projects/:id/name` нь
 * бусдад 403.  Нэр нь ЗӨВХӨН зохиогчийн хяналтад (жагсаалт, баримт, Word,
 * мэдэгдэл) өөрчлөгдөнө; Төслүүд хуудас ба Doc. No.-ийн төслийн код хэвээр.
 * Гэрээний дугаар нь энэ төсөл дээрх БҮХ тайланд (хэвлэх, Word, хүснэгт) орно.
 */
export function AsrProjectNameDialog({
  target,
  onOpenChange,
}: {
  /** `null` = хаалттай. */
  target: AsrProjectNameTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* `key` — өөр төсөл нээхэд талбарын төлөв шинээр эхэлнэ. */}
        {target && <NameForm key={target.id} target={target} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ target, onDone }: { target: AsrProjectNameTarget; onDone: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const original = asrProjectName(target.base_name);
  const [value, setValue] = useState(target.asr_name?.trim() || original);
  const [contractNo, setContractNo] = useState(target.asr_contract_no?.trim() ?? '');
  const [busy, setBusy] = useState(false);

  /** `data` — зөвхөн илгээсэн талбар л сервер дээр хөндөгдөнө. */
  const save = async (data: { asr_name?: string | null; asr_contract_no?: string | null }) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/author-supervision/projects/${target.id}/name`, {
        method: 'PATCH',
        data,
      });
      // ЗХ-ийн бүх асуулга `['asr', …]`-аар эхэлдэг; засварлагч төслийн
      // дэлгэрэнгүйг (`asr_name`) `['/projects', id]`-аас уншдаг.
      void qc.invalidateQueries({ queryKey: ['asr'] });
      void qc.invalidateQueries({ queryKey: ['/projects', String(target.id)] });
      toast.success(t('asr.renameSaved'));
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('asr.renameFailed'));
    } finally {
      setBusy(false);
    }
  };

  const trimmed = value.trim();
  // Анхны нэртэй ижил бол хүчингүйлэгч хадгалахгүй — анхны нэр рүү буцна.
  const submit = () =>
    void save({
      asr_name: trimmed && trimmed !== original ? trimmed : null,
      asr_contract_no: contractNo.trim() || null,
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('asr.renameTitle')}</DialogTitle>
        <DialogDescription>{t('asr.renameHint')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="asr-project-name">{t('asr.renameLabel')}</Label>
        <Input
          id="asr-project-name"
          autoFocus
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <p className="text-micro text-muted-foreground">
          {t('asr.renameOriginal', { name: target.base_name })}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="asr-project-contract-no">{t('asr.contractNo')}</Label>
        <Input
          id="asr-project-contract-no"
          value={contractNo}
          maxLength={200}
          onChange={(e) => setContractNo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <p className="text-micro text-muted-foreground">{t('asr.renameContractHint')}</p>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        {target.asr_name ? (
          // Зөвхөн нэрийг буцаана — гэрээний дугаар хөндөгдөхгүй.
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void save({ asr_name: null })}
          >
            {t('asr.renameReset')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" className="gap-2" disabled={!trimmed || busy} onClick={submit}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('common.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
