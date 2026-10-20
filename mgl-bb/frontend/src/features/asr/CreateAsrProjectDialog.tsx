import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { ASR_PROJECT_OPTIONS_KEY, ASR_TARGETS_KEY } from './targetsApi';

export function CreateAsrProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [shifr, setShifr] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName('');
    setShifr('');
    setContractNo('');
  };

  const close = () => {
    if (busy) return;
    onOpenChange(false);
    reset();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await apiFetch('/author-supervision/targets', {
        method: 'POST',
        data: {
          name: trimmed,
          shifr: shifr.trim() || undefined,
          contract_no: contractNo.trim() || undefined,
        },
      });
      toast.success(t('asr.projectCreated', { name: trimmed }));
      void qc.invalidateQueries({ queryKey: ASR_TARGETS_KEY });
      void qc.invalidateQueries({ queryKey: ASR_PROJECT_OPTIONS_KEY });
      // Төслийн жагсаалт (`/project-summaries`) ч `['asr', …]`-аар эхэлдэг.
      void qc.invalidateQueries({ queryKey: ['asr'] });
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('asr.projectCreateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && (v ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('asr.createProject')}</DialogTitle>
          <DialogDescription>{t('asr.createProjectHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="asr-target-name">{t('asr.projectName')}</Label>
            <Input
              id="asr-target-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t('asr.projectNamePlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asr-target-shifr">{t('asr.shifrOptional')}</Label>
            <Input
              id="asr-target-shifr"
              value={shifr}
              onChange={(e) => setShifr(e.target.value)}
              placeholder={t('asr.shifr')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asr-target-contract-no">{t('asr.contractNoOptional')}</Label>
            <Input
              id="asr-target-contract-no"
              value={contractNo}
              maxLength={200}
              onChange={(e) => setContractNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t('asr.contractNo')}
            />
          </div>
          <Button
            type="button"
            className="w-full gap-2"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('asr.createProject')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
