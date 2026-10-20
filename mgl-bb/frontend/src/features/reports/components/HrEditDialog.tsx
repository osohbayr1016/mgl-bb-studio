import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import type { EmployeeHrPatch, EmployeeHrResponse } from '../types';
import { useSaveHr } from '../api';

/** Гэрээний талбарууд (probation/contract_*) 2026-09-21-нд UI-аас хасагдсан — API талбарууд хэвээр, форм бичихгүй. */
type FormKey = 'hired_at' | 'pc_username' | 'pc_password' | 'phone' | 'notes';
type Form = Record<FormKey, string>;

export function HrEditDialog({
  open,
  onOpenChange,
  userId,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: number;
  data: EmployeeHrResponse;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* DialogContent хаагдахад unmount хийгддэг тул форм нээх бүрт серверийн
            утгаас дахин эхэлнэ — effect дотор setState хэрэггүй. */}
        {open && <HrForm key={data.hr?.updated_at ?? 'new'} userId={userId} data={data} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function fromHr(h: EmployeeHrResponse['hr']): Form {
  return {
    hired_at: h?.hired_at ?? '',
    pc_username: h?.pc_username ?? '',
    pc_password: h?.pc_password ?? '',
    phone: h?.phone ?? '',
    notes: h?.notes ?? '',
  };
}

function HrForm({ userId, data, onClose }: { userId: number; data: EmployeeHrResponse; onClose: () => void }) {
  const { t } = useLanguage();
  const save = useSaveHr(userId);
  const [form, setForm] = useState<Form>(() => fromHr(data.hr));

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: EmployeeHrPatch = {};
    for (const k of Object.keys(form) as Array<keyof Form>) patch[k] = form[k].trim() === '' ? null : form[k].trim();
    save.mutate(patch, {
      onSuccess: () => {
        toast.success(t('reportsPage.hrSaved'));
        onClose();
      },
      onError: (err) => toast.error(t('reportsPage.hrSave'), err.message),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t('reportsPage.hrTitle')}</DialogTitle>
        <DialogDescription>{data.user.full_name}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('reportsPage.hiredAt')}>
          <Input type="date" value={form.hired_at} onChange={set('hired_at')} />
        </Field>
        <Field label={t('reportsPage.pcUsername')}>
          <Input value={form.pc_username} onChange={set('pc_username')} autoComplete="off" maxLength={200} className="font-mono" />
        </Field>
        <Field label={t('reportsPage.pcPassword')}>
          {/* type="text" зориуд — эзний шийдвэрээр ил хадгалагддаг, админ уншиж бичдэг */}
          <Input value={form.pc_password} onChange={set('pc_password')} autoComplete="off" maxLength={200} className="font-mono" />
        </Field>
        <Field label={t('reportsPage.phone')}>
          <Input value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={200} />
        </Field>
        <Field label={t('reportsPage.notes')} className="sm:col-span-2">
          <Textarea value={form.notes} onChange={set('notes')} rows={3} maxLength={4000} />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t('reportsPage.hrCancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {save.isPending ? t('reportsPage.hrSaving') : t('reportsPage.hrSave')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
