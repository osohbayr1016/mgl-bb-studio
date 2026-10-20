import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/dialog';
import { Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';

export type TeamFormState = {
  code: string;
  name_mn: string;
  name_en: string;
  description: string;
  sort_order: number;
};

export function TeamFormDialog({
  open,
  editing,
  form,
  error,
  saving,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  form: TeamFormState;
  error: string;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<TeamFormState>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] border-border bg-card/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('teams.editTitle') : t('teams.newTitle')}</DialogTitle>
          <DialogDescription>
            {editing ? t('teams.editDesc') : t('teams.newDesc')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          {error && (
            <div className="rounded-md bg-destructive/15 p-3 flex items-center text-destructive text-sm border border-destructive/20">
              <AlertCircle className="w-4 h-4 mr-2 shrink-0" /> {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="col-span-1 space-y-2">
              <Label>{t('common.code')} *</Label>
              <Input
                placeholder="BA"
                value={form.code}
                onChange={(e) => onChange({ code: e.target.value.toUpperCase() })}
                className="font-mono uppercase"
                maxLength={10}
                required
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>{t('teams.nameMn')} *</Label>
              <Input
                placeholder={t('teams.namePlaceholderMn')}
                value={form.name_mn}
                onChange={(e) => onChange({ name_mn: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('teams.nameEn')}</Label>
            <Input
              placeholder={t('teams.namePlaceholderEn')}
              value={form.name_en}
              onChange={(e) => onChange({ name_en: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('common.description')}</Label>
            <Input
              placeholder={t('common.descriptionPlaceholder')}
              value={form.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('common.order')}</Label>
            <Input
              type="number"
              placeholder="100"
              value={form.sort_order}
              onChange={(e) => onChange({ sort_order: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">{t('teams.orderHelp')}</p>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
